const doc = (label, note = '', when) => ({ label, required: true, note, ...(when ? { when } : {}) });
const field = (label, type = 'text', options) => ({ label, type, ...(options ? { options } : {}) });

export const serviceCatalog = [
  {
    name: 'Income Certificate', slug: 'income-certificate', description: 'Income certificate application assistance.', serviceCharge: 20000,
    instructions: 'For white ration card holders, Form 16 or ITR is required. Talathi report is required for rural ration card holders.',
    fields: [field('Years of Certificate Required', 'select', ['1 year', '3 years']), field('Reason for application', 'select', ['Banking', 'Ration Card', 'Government Schemes', 'Other']), { ...field('Other reason (please specify)'), required: true, when: { field: 'Reason for application', equals: 'Other' } }, field('Ration card colour', 'select', ['Yellow', 'Orange', 'White']), field('Ration card area', 'select', ['City', 'Village'])],
    documents: [doc('Aadhaar Card'), doc('Photo'), doc('Ration Card'), doc('Form 16 / ITR', 'Required for white ration card holders.', { field: 'Ration card colour', equals: 'White' }), { ...doc('Talathi Report', 'Required for ration card holders in villages. Add a photo of each page, or upload a PDF.', { field: 'Ration card area', equals: 'Village' }), multiple: true }]
  },
  {
    name: 'Age, Nationality & Domicile Certificate', slug: 'domicile-certificate', description: 'Age, nationality and domicile certificate assistance.', serviceCharge: 20000,
    instructions: 'Applicants under 18 need Aadhaar cards for both the applicant and father. The family proof should be dated at least 15 years ago; school leaving certificate must show place and date of birth.',
    fields: [field('Applicant under 18?', 'select', ['Yes', 'No']), { ...field('Applicant', 'select', ['Father', 'Mother', 'Guardian']), when: { field: 'Applicant under 18?', equals: 'Yes' }, defaultWhen: { field: 'Applicant under 18?', equals: 'No', value: 'Self' } }, field('Applicant birth place')],
    documents: [doc('Applicant Aadhaar Card', 'For applicants under 18, upload both applicant and father Aadhaar cards.'), doc('Father Aadhaar Card', 'Required for applicants under 18.', { field: 'Applicant under 18?', equals: 'Yes' }), doc('Photo', 'Photo of the beneficiary.'), doc('Ration Card'), doc('School Leaving Certificate', 'School Leaving Certificate of the beneficiary. Must show place and date of birth.'), doc('Family Member Address Proof (15+ years old)', 'Electricity bill, gas passbook, driving licence, or voter ID belonging to a family member.')]
  },
  {
    name: 'Caste Certificate', slug: 'caste-certificate', description: 'Caste certificate application assistance.',
    instructions: 'Historical lineage evidence noted in the source PDF: OBC / SEBC / SBC before 1967; VJNT before 1961; SC / ST before 1950. Applicants under 18 need both applicant and father Aadhaar cards.',
    fields: [field('Caste category', 'select', ['OBC', 'SEBC', 'SBC', 'VJNT', 'SC', 'ST']), field('Applicant under 18?', 'select', ['Yes', 'No'])],
    documents: [doc('Applicant Aadhaar Card', 'For applicants under 18, upload both applicant and father Aadhaar cards.'), doc('Applicant School Leaving Certificate'), doc('Photo'), doc('Father School Leaving Certificate'), doc('Grandfather / Great-grandfather School Leaving Certificate'), doc('Ration Card'), doc('Historical Caste Proof', 'OBC / SEBC / SBC: before 1967; VJNT: before 1961; SC / ST: before 1950.')]
  },
  {
    name: 'Non-Creamy Layer Certificate', slug: 'non-creamy-layer', description: 'Non-Creamy Layer certificate assistance.',
    instructions: 'Listed for OBC, SEBC, SBC and VJNT categories. Applicants under 18 need both applicant and father Aadhaar cards.',
    fields: [field('Caste category', 'select', ['OBC', 'SEBC', 'SBC', 'VJNT']), field('Applicant under 18?', 'select', ['Yes', 'No'])],
    documents: [doc('Applicant Aadhaar Card', 'For applicants under 18, upload both applicant and father Aadhaar cards.'), doc('School Leaving Certificate'), doc('Photo'), doc('Caste Certificate')]
  },
  {
    name: 'Gazette Notification', slug: 'gazette', description: 'Gazette notification application assistance.',
    documents: [doc('Aadhaar Card'), doc('PAN Card'), doc('Ration Card'), doc('Any One: Marriage Certificate, Birth Certificate, or Affidavit', 'Upload one applicable supporting record.')]
  },
  {
    name: 'Police Clearance Certificate', slug: 'police-clearance', description: 'Police clearance certificate application assistance.',
    fields: [field('Police Station'), field('Reason for clearance')],
    documents: [doc('Aadhaar Card'), doc('Electricity Bill'), doc('School Leaving Certificate'), doc('PAN Card'), doc('Office Letter / NOC'), doc('Photo')]
  },
  {
    name: 'Shop Act / Udyam Aadhaar', slug: 'shop-act-udyam', description: 'Shop Act and Udyam Aadhaar assistance.',
    fields: [field('Shop name'), field('Email', 'email'), field('Business start date', 'date'), field('Shop address'), field('Owned or rented', 'select', ['Owned', 'Rented']), field('Number of workers', 'number'), field('Business type'), field('Years at Aadhaar address', 'number'), field('Shop size (sq. ft.)', 'number'), field('Business investment', 'number')],
    documents: [doc('Owner Aadhaar Card'), doc('Owner Photo'), doc('Owner Signature Image'), doc('Owner PAN Card'), doc('Shop Board Photo')]
  },
  {
    name: 'Caste Validity Certificate', slug: 'caste-validity', description: 'Caste validity certificate application assistance.',
    instructions: 'Historical evidence cutoffs in the source PDF: OBC / SEBC / SBC before 1967; VJNT before 1961; SC / ST before 1950. Upload relative caste validity record only if one exists.',
    fields: [field('Mobile', 'tel'), field('Email', 'email'), field('Kuldev'), field('Surname (as requested in form)'), field('Applicant education: standards 1–4, school and years'), field('Applicant education: standards 5–8, school and years'), field('Applicant education: standards 9–10, school and years'), field('Applicant education: standards 11–12, college and years'), field('Father education: standards 1–4, school and years'), field('Father education: standards 5–8, school and years'), field('Father education: standards 9–10, school and years'), field('Father education: standards 11–12, college and years'), field('Father graduation details')],
    documents: [doc('Applicant Aadhaar Card'), doc('Applicant School Leaving Certificate'), doc('Applicant Photo'), doc('Applicant Caste Certificate'), doc('Form 15A'), doc('Father School Leaving Certificate / Bonafide'), doc('Ration Card'), doc('Father Photo'), doc('Father Aadhaar Card'), doc('Relative School Leaving Certificate / Bonafide (pre-1967)', 'Grandfather, aunt, or uncle record, as applicable.'), doc('Historical Revenue Proof (pre-1967)', 'Property card, house assessment, or electoral roll.'), doc('Family Member Caste Validity Record', 'Only if a family member already has caste validity.'), doc('Applicant Signature Image'), doc('Father Signature Image'), doc('Live Photo')]
  },
  {
    name: 'EWS Certificate', slug: 'ews-certificate', description: 'EWS certificate application assistance.',
    instructions: 'The source PDF lists a certificate period of 1 April 2026 to 31 March 2027.',
    documents: [doc('Aadhaar Card'), doc('Ration Card'), doc('Photo'), doc('Applicant School Leaving Certificate'), doc('Income Certificate'), doc('Residence Certificate'), doc('Father School Leaving Certificate'), doc('Relative School Leaving Certificate (pre-1967)', 'Grandfather, aunt, or uncle record.'), doc('Historical Revenue Proof (pre-1967)', 'Old assessment extract, 7/12 extract, or property card.'), doc('Current Assessment Extract')]
  },
  {
    name: 'Food License', slug: 'food-license', description: 'Food licence application assistance.',
    fields: [field('Licence duration', 'select', ['1 year', '2 years', '3 years', '4 years', '5 years']), field('Business category', 'select', ['Service', 'Retail', 'Manufacturing'])],
    documents: [doc('Aadhaar Card'), doc('Photo'), doc('Electricity Bill'), doc('Rent Agreement'), doc('Property Tax Record'), doc('PAN Card'), doc('Business Photos (inside and outside)')]
  },
  {
    name: 'Passport', slug: 'passport', description: 'Passport application assistance.',
    fields: [field('Mobile', 'tel'), field('Email', 'email'), field('Qualification'), field('Father name'), field('Mother name'), field('Husband / Wife name'), field('Emergency contact name'), field('Emergency contact number', 'tel'), field('Police Station'), field('Birth place')],
    documents: [doc('Aadhaar Card'), doc('PAN Card')]
  },
  {
    name: 'Voting Card', slug: 'voting-card', description: 'Voter ID card application assistance.',
    fields: [field('Mobile', 'tel')],
    documents: [doc('Aadhaar Card'), doc('Photo')]
  },
  {
    name: 'PAN Card', slug: 'pan', description: 'PAN card application assistance.',
    documents: [doc('Aadhaar Card'), doc('Photo'), doc('Signature Image'), doc('Any One Date of Birth Proof', 'Birth certificate, driving licence, or voter ID card. Date of birth must be shown.')]
  },
  {
    name: 'PF Assistance', slug: 'pf-assistance', description: 'PF account assistance.',
    instructions: 'The source checklist requests UAN and password. For security, do not upload or save a password here. The customer should enter it directly in the official portal during an assisted session.',
    fields: [],
    documents: [doc('Bank Passbook')]
  },
  {
    name: 'Ration Card', slug: 'ration-card', description: 'Ration card member, unit, and detail update assistance.',
    fields: [field('Unit change', 'select', ['No change', 'Unit decreased', 'Unit increased'])],
    documents: [doc('Aadhaar, PAN and Photo for All Members'), doc('Electricity Bill'), doc('Income Certificate'), doc('Death Certificate / Marriage Certificate', 'Required when the unit is decreased.', { field: 'Unit change', equals: 'Unit decreased' }), doc('Name Change Record / Birth Certificate', 'Required when the unit is increased.', { field: 'Unit change', equals: 'Unit increased' })]
  }
];

// Model conditional proofs as separate checklist items so each can be validated.
for (const slug of ['caste-certificate','non-creamy-layer']) {
  serviceCatalog.find(service => service.slug === slug).documents.push(doc('Father Aadhaar Card', 'Required for applicants under 18.', { field:'Applicant under 18?', equals:'Yes' }));
}
const validity = serviceCatalog.find(service => service.slug === 'caste-validity');
validity.fields.push(field('Family member already has caste validity?', 'select', ['Yes','No']));
validity.documents.find(document => document.label === 'Family Member Caste Validity Record').when = { field:'Family member already has caste validity?', equals:'Yes' };
