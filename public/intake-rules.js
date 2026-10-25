// Shared by the browser and server so checklist, field and fee rules agree.
globalThis.IntakeRules = (() => {
  const available = 'Is Talathi Report available?';
  const willing = 'Will you bring a signed Talathi Report?';
  const addressProof = 'Do you have proof confirming the entered address?';
  function matches(when, details = {}, includeUnknown = false) {
    if (!when) return true;
    if (when.all) return when.all.every(rule => matches(rule, details, includeUnknown));
    if (when.any) return when.any.some(rule => matches(rule, details, includeUnknown));
    if (when.incomeAbove !== undefined) {
      return Object.entries(details).some(([label, value]) =>
        (details['Years of Certificate Required'] === '3 years' ? /^\d{4}-\d{4} income required/.test(label) : label.startsWith('Income amount required on certificate')) && Number(value) > when.incomeAbove);
    }
    const value = details[when.field];
    return value === undefined || String(value).trim() === '' ? includeUnknown : String(value) === String(when.equals);
  }
  function surcharge(details = {}) {
    const talathi = details['Ration card area'] === 'City' && details[available] === 'No' && details[willing] === 'No' ? 20000 : 0;
    const affidavit = details[addressProof] === 'No' ? 20000 : 0;
    return talathi + affidavit;
  }
  function withSurcharge(amounts, details) {
    const extra = surcharge(details);
    return { ...amounts, serviceCharge: amounts.serviceCharge + extra, total: amounts.total + extra, surcharge: extra };
  }
  function applyComputed(fields, details) {
    for (const field of fields) {
      if (!field.computedSum) continue;
      const values = field.computedSum.map(label => String(details[label] ?? '').trim());
      details[field.label] = values.every(value => value !== '' && Number.isFinite(Number(value))) ? String(values.reduce((sum, value) => sum + Number(value), 0)) : '';
    }
  }
  return { matches, surcharge, withSurcharge, available, willing, addressProof, applyComputed };
})();
