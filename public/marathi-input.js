// Local phonetic input: names stay in the browser while they are converted.
globalThis.MarathiInput = (() => {
  function convert(value) {
    return value.replace(/[A-Za-z~^]+/g, word =>
      globalThis.Sanscript.t(word, 'itrans', 'devanagari').replace(/्$/u, ''));
  }
  function preview(input) {
    const output = input.closest('label')?.querySelector('.marathi-preview');
    if (output) output.textContent = /[A-Za-z]/.test(input.value) ? `मराठी: ${convert(input.value)}` : '';
  }
  function commit(input) {
    if (!input.matches('[data-marathi-input]') || !/[A-Za-z]/.test(input.value)) return;
    const caret = input.selectionStart;
    const prefix = convert(input.value.slice(0, caret));
    input.value = convert(input.value);
    input.setSelectionRange(prefix.length, prefix.length);
    preview(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.addEventListener('input', event => {
    const input = event.target;
    if (!input.matches('[data-marathi-input]') || event.isComposing) return;
    // Keep a word editable until Space/punctuation is typed, as in a phonetic keyboard.
    if (/\s|[-.,]/.test(event.data || '')) commit(input);
    preview(input);
  });
  document.addEventListener('compositionend', event => {
    if (event.target.matches('[data-marathi-input]')) preview(event.target);
  });
  document.addEventListener('blur', event => {
    if (event.target.matches('[data-marathi-input]')) commit(event.target);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.target.matches('[data-marathi-input]')) {
      event.preventDefault();
      commit(event.target);
      event.target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  return { convert, commit };
})();
