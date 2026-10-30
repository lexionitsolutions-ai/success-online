// Convert phonetic keystrokes locally, before inserting them into Marathi names.
globalThis.MarathiInput = (() => {
  const words = new WeakMap();
  const updating = new WeakSet();
  function convert(value) {
    return value.replace(/[A-Za-z~^]+/g, word =>
      globalThis.Sanscript.t(word, 'itrans', 'devanagari').replace(/्$/u, ''));
  }
  const clean = value => convert(value).replace(/[^\u0900-\u0963\u0971-\u097F\s\u200C\u200D]/gu, '');
  function preview(input) {
    const output = input.closest('label')?.querySelector('.marathi-preview');
    if (output) output.textContent = '';
  }
  function notify(input) {
    updating.add(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    updating.delete(input);
  }
  function commit(input) {
    if (!input.matches('[data-marathi-input]')) return;
    const caret = input.selectionStart ?? input.value.length;
    const value = clean(input.value);
    if (value !== input.value) {
      const prefix = clean(input.value.slice(0, caret));
      input.value = value;
      input.setSelectionRange(prefix.length, prefix.length);
      notify(input);
    }
    preview(input);
  }
  document.addEventListener('beforeinput', event => {
    const input = event.target;
    if (!input.matches('[data-marathi-input]') || event.isComposing || !event.cancelable || event.inputType !== 'insertText' || !/^[A-Za-z~^]+$/.test(event.data || '')) return;
    event.preventDefault();
    const start = input.selectionStart, end = input.selectionEnd;
    let word = words.get(input);
    if (!word || word.value !== input.value || start !== end || start !== word.caret) {
      word = { prefix: input.value.slice(0, start), suffix: input.value.slice(end), raw: '' };
    }
    word.raw += event.data;
    const converted = clean(word.raw);
    input.value = word.prefix + converted + word.suffix;
    word.caret = word.prefix.length + converted.length;
    word.value = input.value;
    input.setSelectionRange(word.caret, word.caret);
    words.set(input, word);
    preview(input);
    notify(input);
  });
  document.addEventListener('input', event => {
    const input = event.target;
    if (!input.matches('[data-marathi-input]') || event.isComposing || updating.has(input)) return;
    words.delete(input);
    commit(input);
  });
  document.addEventListener('compositionend', event => {
    if (event.target.matches('[data-marathi-input]')) { words.delete(event.target); commit(event.target); }
  });
  document.addEventListener('blur', event => {
    if (event.target.matches('[data-marathi-input]')) { words.delete(event.target); commit(event.target); }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.target.matches('[data-marathi-input]')) {
      event.preventDefault();
      words.delete(event.target);
      commit(event.target);
      event.target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  return { convert, commit };
})();
