'use strict';

class MongoAdapter {
  async connect(config) {
    let mongodb;
    try {
      mongodb = require('mongodb');
    } catch (e) {
      throw new Error(
        'MongoDB adapter requires the "mongodb" package. Install it with: npm install mongodb'
      );
    }

    const uri = config.uri || `mongodb://${config.host || 'localhost'}:${config.port || 27017}`;
    const client = new mongodb.MongoClient(uri, config.options || {});
    await client.connect();
    const db = client.db(config.database);

    return new MongoConnection(client, db);
  }
}

class MongoConnection {
  constructor(client, db) {
    this.client = client;
    this.db = db;
  }

  collection(name) {
    return this.db.collection(name);
  }

  async query(collectionName, filter = {}, options = {}) {
    const collection = this.db.collection(collectionName);
    return collection.find(filter, options).toArray();
  }

  async insert(collectionName, data) {
    const collection = this.db.collection(collectionName);
    if (Array.isArray(data)) {
      return collection.insertMany(data);
    }
    return collection.insertOne(data);
  }

  async update(collectionName, filter, data) {
    const collection = this.db.collection(collectionName);
    return collection.updateMany(filter, { $set: data });
  }

  async delete(collectionName, filter) {
    const collection = this.db.collection(collectionName);
    return collection.deleteMany(filter);
  }

  async transaction(fn) {
    const session = this.client.startSession();
    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }

  async close() {
    await this.client.close();
  }
}

module.exports = { MongoAdapter };
