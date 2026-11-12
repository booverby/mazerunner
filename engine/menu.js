export function createMenu(root) {
  const make = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const focusables = () => [...root.querySelectorAll('button:not(:disabled), input')];
  let sliderCount = 0;

  root.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
    const items = focusables();
    const i = items.indexOf(document.activeElement);
    const next = items[(i + (e.code === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
    // Also stops a focused slider from changing value on up/down; left/right still do.
    e.preventDefault();
  });

  const slider = ({ label, min, max, step, value, format = String, onInput }) => {
    const id = `menu-slider-${++sliderCount}`;
    const row = make('div', '', 'menu-slider');
    const head = make('div', '', 'menu-slider-head');
    const name = make('label', label);
    name.htmlFor = id;
    const shown = make('output', format(value));
    shown.htmlFor = id;
    const input = make('input');
    Object.assign(input, { type: 'range', id, min, max, step, value });
    input.setAttribute('aria-valuetext', format(value));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      shown.textContent = format(v);
      input.setAttribute('aria-valuetext', format(v));
      onInput?.(v);
    });
    head.append(name, shown);
    row.append(head, input);
    return row;
  };

  return {
    show({ title, text, controls = [], buttons = [], focus = 0 }) {
      root.replaceChildren(make('h1', title));
      if (text) root.append(make('p', text));
      if (controls.length) {
        const box = make('div', '', 'menu-controls');
        for (const control of controls) if (control.type === 'slider') box.append(slider(control));
        root.append(box);
      }
      const list = make('div', '', 'menu-buttons');
      for (const { label, detail, disabled, pressed, onClick } of buttons) {
        const button = make('button', label);
        button.type = 'button';
        button.disabled = Boolean(disabled);
        if (pressed !== undefined) button.setAttribute('aria-pressed', String(Boolean(pressed)));
        if (detail) button.append(make('span', detail, 'menu-detail'));
        button.addEventListener('click', onClick);
        list.append(button);
      }
      if (buttons.length) root.append(list);
      root.classList.remove('hidden');
      const items = focusables();
      (items[focus] || items[0])?.focus();
    },
    hide() {
      root.classList.add('hidden');
      root.replaceChildren();
    },
  };
}
