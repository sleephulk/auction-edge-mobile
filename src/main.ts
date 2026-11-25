import './style.css';
import { currentEmail, isSignedIn, onAuthChange, signIn, signOut } from './auth';
import { mountChart, type ChartApp } from './chart';

const app = document.getElementById('app')!;
let chart: ChartApp | null = null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderLogin(): void {
  chart?.destroy();
  chart = null;
  app.replaceChildren();
  const form = h('form', 'login');
  form.append(h('h1', '', 'AE Pocket'), h('p', '', 'Sign in with your Auction Edge account.'));
  const email = h('input');
  email.type = 'email';
  email.placeholder = 'Email';
  email.autocomplete = 'username';
  email.required = true;
  const pass = h('input');
  pass.type = 'password';
  pass.placeholder = 'Password';
  pass.autocomplete = 'current-password';
  pass.required = true;
  const btn = h('button', '', 'Sign in');
  btn.type = 'submit';
  const err = h('div', 'err');
  form.append(email, pass, btn, err);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    btn.disabled = true;
    err.textContent = '';
    signIn(email.value.trim(), pass.value)
      .catch((e: unknown) => {
        err.textContent = e instanceof Error ? e.message : 'Sign-in failed';
      })
      .finally(() => {
        btn.disabled = false;
      });
  });
  app.append(form);
}

function renderChart(): void {
  app.replaceChildren();
  chart = mountChart(app, { email: currentEmail(), onSignOut: signOut });
}

function render(): void {
  if (isSignedIn()) renderChart();
  else renderLogin();
}

onAuthChange(render);
render();
