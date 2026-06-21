'use strict';

const crypto = require('crypto');

class WebSocketManager {
  constructor(server) {
    this.server = server;
    this.clients = new Map();
    this.rooms = new Map();
    this.handlers = {};
  }

  handleUpgrade(req, socket, head) {
    if (req.headers['upgrade'] !== 'websocket') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC11650A')
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      ''
    ].join('\r\n');

    socket.write(headers);

    const clientId = crypto.randomUUID();
    const client = {
      id: clientId,
      socket: socket,
      alive: true,
      rooms: new Set()
    };

    this.clients.set(clientId, client);
    this._emit('connection', client);

    socket.on('data', (data) => {
      const frame = this._decodeFrame(data);
      if (!frame) return;

      if (frame.opcode === 0x8) {
        this._removeClient(clientId);
        return;
      }

      if (frame.opcode === 0x9) {
        this._sendPong(socket, frame.payload);
        return;
      }

      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        const message = frame.opcode === 0x1 
          ? frame.payload.toString('utf8')
          : frame.payload;
        this._emit('message', client, message);
      }
    });

    socket.on('close', () => {
      this._removeClient(clientId);
    });

    socket.on('error', () => {
      this._removeClient(clientId);
    });
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  _emit(event, ...args) {
    const handlers = this.handlers[event];
    if (!handlers) return;
    for (const handler of handlers) {
      handler(...args);
    }
  }

  broadcast(message, exclude) {
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const frame = this._encodeFrame(payload, 0x1);
    for (const [id, client] of this.clients) {
      if (id !== exclude && client.socket.writable) {
        client.socket.write(frame);
      }
    }
  }

  join(clientId, room) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room).add(clientId);
    const client = this.clients.get(clientId);
    if (client) client.rooms.add(room);
  }

  leave(clientId, room) {
    if (this.rooms.has(room)) this.rooms.get(room).delete(clientId);
    const client = this.clients.get(clientId);
    if (client) client.rooms.delete(room);
  }

  toRoom(room, message) {
    const members = this.rooms.get(room);
    if (!members) return;
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    const frame = this._encodeFrame(payload, 0x1);
    for (const clientId of members) {
      const client = this.clients.get(clientId);
      if (client && client.socket.writable) {
        client.socket.write(frame);
      }
    }
  }

  send(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || !client.socket.writable) return;
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    client.socket.write(this._encodeFrame(payload, 0x1));
  }

  _removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;
    for (const room of client.rooms) {
      if (this.rooms.has(room)) this.rooms.get(room).delete(clientId);
    }
    this.clients.delete(clientId);
    this._emit('disconnect', client);
    try { client.socket.end(); } catch (e) {}
  }

  _decodeFrame(buffer) {
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null;
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null;
      payloadLength = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }

    let maskKey = null;
    if (isMasked) {
      if (buffer.length < offset + 4) return null;
      maskKey = buffer.slice(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + payloadLength) return null;
    const payload = buffer.slice(offset, offset + payloadLength);

    if (maskKey) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskKey[i % 4];
      }
    }

    return { opcode, payload };
  }

  _encodeFrame(data, opcode) {
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    return Buffer.concat([header, payload]);
  }

  _sendPong(socket, payload) {
    const frame = this._encodeFrame(payload, 0xa);
    if (socket.writable) socket.write(frame);
  }
}

module.exports = { WebSocketManager };
