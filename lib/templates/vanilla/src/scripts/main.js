'use strict';

const $ = (sel, ctx = document) => ctx.querySelector(sel);

function initMobileMenu() {
  const toggle = $('.nav-toggle');
  const menu = $('.nav-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('active');
    menu.classList.toggle('active');
  });

  menu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      toggle.classList.remove('active');
      menu.classList.remove('active');
    });
  });
}

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return;
      const target = $(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function initContactForm() {
  const form = $('#contact-form');
  const status = $('#form-status');
  if (!form || !status) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.textContent = 'Sending...';
    status.className = 'form-status';
    status.textContent = '';

    await new Promise(r => setTimeout(r, 1000));

    console.log('Form submitted:', data);

    status.textContent = 'Message sent successfully! We\'ll get back to you soon.';
    status.className = 'form-status success show';
    form.reset();
    btn.disabled = false;
    btn.textContent = 'Send Message';

    setTimeout(() => {
      status.className = 'form-status';
    }, 5000);
  });
}

function setFooterYear() {
  const el = $('#year');
  if (el) el.textContent = new Date().getFullYear();
}

document.addEventListener('DOMContentLoaded', () => {
  initMobileMenu();
  initSmoothScroll();
  initContactForm();
  setFooterYear();
});
