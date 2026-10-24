const doc = (label, note = '', when) => ({ label, required: true, note, ...(when ? { when } : {}) });
const field = (label, type = 'text', options) => ({ label, type, ...(options ? { options } : {}) });
const incomeAmount = label => ({ ...field(label, 'number'), min: 0, step: '0.01', inputMode: 'decimal', placeholder: 'e.g. 150000' });
const today = new Date();
const financialYear = Number(today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric' })) - (Number(today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric' })) < 4 ? 1 : 0);
const incomeYears = ['2021-2022', '2022-2023', '2023-2024'];
const singleIncomeYear = `${financialYear - 1}-${financialYear}`;

export const serviceCatalog = [
  {
    name: 'Income Certificate', slug: 'income-certificate', description: 'Income certificate application assistance.', serviceCharge: 20000,
    instructions: 'For white ration card holders, Form 16 or ITR is required. Talathi report is required for rural ration card holders.',
    fields: [
      field('Years of Certificate Required', 'select', ['1 year', '3 years']),
      { ...incomeAmount('Income amount required on certificate (₹)'), displayLabel: `${singleIncomeYear} income required (₹)`, when: { field: 'Years of Certificate Required', equals: '1 year' } },
      ...incomeYears.map(year => ({ ...incomeAmount(`${year} income required (₹)`), required: true, when: { field: 'Years of Certificate Required', equals: '3 years' } })),
      field('Reason for application', 'select', ['Banking', 'Ration Card', 'Government Schemes', 'Education', 'Hospital', 'Other']),
      { ...field('Other reason (please specify)'), required: true, when: { field: 'Reason for application', equals: 'Other' } },
      field('Ration card colour', 'select', ['Yellow', 'Orange', 'White']), field('Ration card area', 'select', ['City', 'Village']),
      { ...field('Is Talathi Report available?', 'select', ['Yes', 'No']), displayLabel: 'Is a Talathi report available? / तलाठी अहवाल उपलब्ध आहे का?', when: { field: 'Ration card area', equals: 'City' } },
      { ...field('Will you bring a signed Talathi Report?', 'select', ['Yes', 'No']), displayLabel: 'Will you obtain and bring a signed and stamped Talathi report? / तलाठ्यांची सही व शिक्का असलेला अहवाल आणण्यास आपण तयार आहात का?', when: { all: [{ field: 'Ration card area', equals: 'City' }, { field: 'Is Talathi Report available?', equals: 'No' }] } }
    ],
    documents: [
      { ...doc('Aadhaar Card'), marathiLabel: 'आधार कार्ड' },
      { ...doc('Photo'), marathiLabel: 'अर्जदाराचा फोटो' },
      { ...doc('Ration Card'), marathiLabel: 'रेशन कार्ड' },
      { ...doc('Form 16 / ITR', 'Upload Form 16 or ITR for white ration card holders. / पांढऱ्या रेशन कार्डधारकांसाठी फॉर्म १६ किंवा आयकर विवरणपत्र आवश्यक आहे.', { field: 'Ration card colour', equals: 'White' }), marathiLabel: 'फॉर्म १६ / आयकर विवरणपत्र (ITR)' },
      { ...doc('Salary/Pay Slip / ITR / Form 16', 'Upload any ONE: Salary/Pay Slip, ITR (Income Tax Return), or Form 16. / यापैकी कोणताही एक पुरावा अपलोड करा: वेतन पावती, आयकर विवरणपत्र किंवा फॉर्म १६.', { all: [{ incomeAbove: 100000 }, { any: [{ field: 'Ration card colour', equals: 'Yellow' }, { field: 'Ration card colour', equals: 'Orange' }] }] }), marathiLabel: 'वेतन पावती / आयकर विवरणपत्र / फॉर्म १६ (कोणताही एक)' },
      { ...doc('Hospital Letter / Medical Certificate', 'Hospital Letter / वैद्यकीय दाखला (मराठी) / चिकित्सा प्रमाण पत्र (हिंदी)', { field: 'Reason for application', equals: 'Hospital' }), marathiLabel: 'रुग्णालयाचे पत्र / वैद्यकीय दाखला', displayLabel: 'Hospital Letter / वैद्यकीय दाखला / चिकित्सा प्रमाण पत्र' },
      { ...doc('Talathi Report', 'Upload the signed and stamped report. Add a photo of each page, or upload a PDF. / तलाठ्यांची सही व शिक्का असलेला अहवाल अपलोड करा.', { any: [{ field: 'Ration card area', equals: 'Village' }, { all: [{ field: 'Ration card area', equals: 'City' }, { any: [{ field: 'Is Talathi Report available?', equals: 'Yes' }, { field: 'Will you bring a signed Talathi Report?', equals: 'Yes' }] }] }] }), marathiLabel: 'तलाठी अहवाल', multiple: true }
    ]
  },
  {
    name: 'Age Nationality & Domicile Certificate', slug: 'domicile-certificate', description: 'Age nationality and domicile certificate assistance.', serviceCharge: 20000,
    instructions: 'Applicants under 18 need Aadhaar cards for both the applicant and father. The family proof should be dated at least 15 years ago; school leaving certificate must show place and date of birth.',
    fields: [
      field('Applicant under 18?', 'select', ['Yes', 'No']),
      { ...field('Applicant', 'select', ['Father', 'Mother', 'Guardian']), when: { field: 'Applicant under 18?', equals: 'Yes' }, defaultWhen: { field: 'Applicant under 18?', equals: 'No', value: 'Self' } },
      { ...field('Is beneficiary birth place in Maharashtra?', 'select', ['Yes', 'No']), displayLabel: 'Was the beneficiary born in Maharashtra? / लाभार्थ्याचा जन्म महाराष्ट्रात झाला आहे का?' },
      { ...field('Birth certificate address'), displayLabel: 'Full address as on Birth Certificate / जन्म दाखल्यावरील संपूर्ण पत्ता', placeholder: 'Address, city and state as shown on the Birth Certificate', required: true, fullWidth: true, when: { field: 'Is beneficiary birth place in Maharashtra?', equals: 'No' } },
      { ...field('Do you have proof confirming the entered address?', 'select', ['Yes', 'No']), displayLabel: 'Do you have address proof confirming that the address you entered is correct? / आपण भरलेला पत्ता बरोबर असल्याची पुष्टी करणारा पत्त्याचा पुरावा आपल्याकडे आहे का?', fullWidth: true }
    ],
    documents: [doc('Applicant Aadhaar Card', 'For applicants under 18, upload both applicant and father Aadhaar cards.'), doc('Father Aadhaar Card', 'Required for applicants under 18.', { field: 'Applicant under 18?', equals: 'Yes' }), doc('Photo', 'Photo of the beneficiary.'), doc('Ration Card'), doc('School Leaving Certificate', 'School Leaving Certificate of the beneficiary. Must show place and date of birth.'), doc('Family Member Address Proof (15+ years old)', 'Electricity bill, gas passbook, driving licence, or voter ID belonging to a family member.')]
  },
  {
    name: 'Caste Certificate', slug: 'caste-certificate', description: 'Caste certificate application assistance.',
    instructions: 'Historical lineage evidence noted in the source PDF: OBC / SEBC / SBC before 1967; VJNT before 1961; SC / ST before 1950. Applicants under 18 need both applicant and father Aadhaar cards.',
    fields: [
      field('Caste category', 'select', ['OBC', 'SEBC', 'SBC', 'VJNT', 'SC', 'ST']),
      { ...field('Original caste name'), displayLabel: 'Please enter your original caste name. / कृपया आपल्या मूळ जातीचे नाव लिहा.', placeholder: 'Original caste name / मूळ जातीचे नाव' },
      field('Applicant under 18?', 'select', ['Yes', 'No'])
    ],
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
    fields: [field('Shop name'), field('Business start date', 'date'), field('Shop address'), field('Owned or rented', 'select', ['Owned', 'Rented']), field('Number of workers', 'number'), field('Business type'), field('Years at Aadhaar address', 'number'), field('Shop size (sq. ft.)', 'number'), field('Business investment', 'number')],
    documents: [doc('Owner Aadhaar Card'), doc('Owner Photo'), doc('Owner Signature Image'), doc('Owner PAN Card'), doc('Shop Board Photo')]
  },
  {
    name: 'Caste Validity Certificate', slug: 'caste-validity', description: 'Caste validity certificate application assistance.',
    instructions: 'Historical evidence cutoffs in the source PDF: OBC / SEBC / SBC before 1967; VJNT before 1961; SC / ST before 1950. Upload relative caste validity record only if one exists.',
    fields: [field('Mobile', 'tel'), field('Kuldev'), field('Surname (as requested in form)'), field('Applicant education: standards 1–4, school and years'), field('Applicant education: standards 5–8, school and years'), field('Applicant education: standards 9–10, school and years'), field('Applicant education: standards 11–12, college and years'), field('Father education: standards 1–4, school and years'), field('Father education: standards 5–8, school and years'), field('Father education: standards 9–10, school and years'), field('Father education: standards 11–12, college and years'), field('Father graduation details')],
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
    fields: [field('Mobile', 'tel'), field('Qualification'), field('Father name'), field('Mother name'), field('Husband / Wife name'), field('Emergency contact name'), field('Emergency contact number', 'tel'), field('Police Station'), field('Birth place')],
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

// Keep stored document labels stable for existing uploads; translate the checklist presentation.
const marathiDocuments = {
  'Aadhaar Card': 'आधार कार्ड',
  'Photo': 'अर्जदाराचा फोटो',
  'Ration Card': 'रेशन कार्ड',
  'Applicant Aadhaar Card': 'अर्जदाराचे आधार कार्ड',
  'Father Aadhaar Card': 'वडिलांचे आधार कार्ड',
  'School Leaving Certificate': 'शाळा सोडल्याचा दाखला',
  'Family Member Address Proof (15+ years old)': 'कुटुंबातील सदस्याचा किमान १५ वर्षे जुना पत्त्याचा पुरावा',
  'Applicant School Leaving Certificate': 'अर्जदाराचा शाळा सोडल्याचा दाखला',
  'Father School Leaving Certificate': 'वडिलांचा शाळा सोडल्याचा दाखला',
  'Grandfather / Great-grandfather School Leaving Certificate': 'आजोबा / पणजोबांचा शाळा सोडल्याचा दाखला',
  'Historical Caste Proof': 'जातीचा जुना पुरावा',
  'Caste Certificate': 'जातीचा दाखला',
  'PAN Card': 'पॅन कार्ड',
  'Any One: Marriage Certificate, Birth Certificate, or Affidavit': 'विवाह प्रमाणपत्र, जन्म दाखला किंवा प्रतिज्ञापत्र (कोणतेही एक)',
  'Electricity Bill': 'वीज बिल',
  'Office Letter / NOC': 'कार्यालयाचे पत्र / ना हरकत प्रमाणपत्र',
  'Owner Aadhaar Card': 'मालकाचे आधार कार्ड',
  'Owner Photo': 'मालकाचा फोटो',
  'Owner Signature Image': 'मालकाच्या सहीचा फोटो',
  'Owner PAN Card': 'मालकाचे पॅन कार्ड',
  'Shop Board Photo': 'दुकानाच्या फलकाचा फोटो',
  'Applicant Photo': 'अर्जदाराचा फोटो',
  'Applicant Caste Certificate': 'अर्जदाराचा जातीचा दाखला',
  'Form 15A': 'फॉर्म १५अ',
  'Father School Leaving Certificate / Bonafide': 'वडिलांचा शाळा सोडल्याचा दाखला / बोनाफाईड प्रमाणपत्र',
  'Father Photo': 'वडिलांचा फोटो',
  'Relative School Leaving Certificate / Bonafide (pre-1967)': 'नातेवाईकाचा १९६७ पूर्वीचा शाळा सोडल्याचा दाखला / बोनाफाईड प्रमाणपत्र',
  'Historical Revenue Proof (pre-1967)': '१९६७ पूर्वीचा महसुली पुरावा',
  'Family Member Caste Validity Record': 'कुटुंबातील सदस्याचे जात वैधता प्रमाणपत्र',
  'Applicant Signature Image': 'अर्जदाराच्या सहीचा फोटो',
  'Father Signature Image': 'वडिलांच्या सहीचा फोटो',
  'Live Photo': 'प्रत्यक्ष काढलेला फोटो',
  'Income Certificate': 'उत्पन्नाचा दाखला',
  'Residence Certificate': 'रहिवासी दाखला',
  'Relative School Leaving Certificate (pre-1967)': 'नातेवाईकाचा १९६७ पूर्वीचा शाळा सोडल्याचा दाखला',
  'Current Assessment Extract': 'सध्याचा आकारणी उतारा',
  'Rent Agreement': 'भाडे करार',
  'Property Tax Record': 'मालमत्ता कराची नोंद / पावती',
  'Business Photos (inside and outside)': 'व्यवसायाच्या आतील व बाहेरील भागाचे फोटो',
  'Signature Image': 'सहीचा फोटो',
  'Any One Date of Birth Proof': 'जन्मतारखेचा कोणताही एक पुरावा',
  'Bank Passbook': 'बँक पासबुक',
  'Aadhaar, PAN and Photo for All Members': 'सर्व सदस्यांची आधार कार्डे, पॅन कार्डे व फोटो',
  'Death Certificate / Marriage Certificate': 'मृत्यू प्रमाणपत्र / विवाह प्रमाणपत्र',
  'Name Change Record / Birth Certificate': 'नाव बदलाचा पुरावा / जन्म दाखला'
};

// Each line becomes one highlighted note in the shared guidance panel.
const serviceNotes = {
  'domicile-certificate': [
    '१८ वर्षांखालील अर्जदारांसाठी अर्जदाराचे व वडिलांचे आधार कार्ड आवश्यक आहे. / Applicants under 18 need Aadhaar cards for both the applicant and father.',
    'कुटुंबातील सदस्याचा पत्त्याचा पुरावा किमान १५ वर्षे जुना असावा. वीज बिल, गॅस पासबुक, वाहनचालक परवाना किंवा मतदार ओळखपत्र वापरता येईल. / Family address proof must be at least 15 years old; use an electricity bill, gas passbook, driving licence or voter ID.',
    'शाळा सोडल्याच्या दाखल्यावर जन्मस्थळ व जन्मतारीख नमूद असावी. / The school leaving certificate must show the place and date of birth.',
    'लाभार्थ्याचा जन्म महाराष्ट्राबाहेर झाला असल्यास जन्म दाखल्यावरील संपूर्ण पत्ता (शहर व राज्यासह) एकाच ठिकाणी अचूक भरा. / If born outside Maharashtra, enter the full address, including city and state, in the single Birth Certificate address field.'
  ],
  'caste-certificate': [
    'जातीच्या जुन्या पुराव्याचा कालावधी: OBC / SEBC / SBC साठी १९६७ पूर्वीचा; VJNT साठी १९६१ पूर्वीचा; SC / ST साठी १९५० पूर्वीचा. / Historical caste proof: OBC / SEBC / SBC before 1967; VJNT before 1961; SC / ST before 1950.',
    '१८ वर्षांखालील अर्जदारांसाठी अर्जदाराचे व वडिलांचे आधार कार्ड आवश्यक आहे. / Applicants under 18 need Aadhaar cards for both the applicant and father.'
  ],
  'non-creamy-layer': [
    'ही सेवा OBC, SEBC, SBC व VJNT प्रवर्गांसाठी आहे. / This service is listed for OBC, SEBC, SBC and VJNT categories.',
    '१८ वर्षांखालील अर्जदारांसाठी अर्जदाराचे व वडिलांचे आधार कार्ड आवश्यक आहे. / Applicants under 18 need Aadhaar cards for both the applicant and father.'
  ],
  'gazette': ['विवाह प्रमाणपत्र, जन्म दाखला किंवा प्रतिज्ञापत्र यापैकी लागू असलेला कोणताही एक पुरावा अपलोड करा. / Upload any one applicable proof: marriage certificate, birth certificate or affidavit.'],
  'police-clearance': ['निवडलेल्या पोलीस ठाण्याची व अर्जाच्या कारणाची माहिती तपासा आणि आवश्यक कागदपत्रे स्पष्ट स्वरूपात अपलोड करा. / Check the police station and reason for clearance, and upload clear copies of the required documents.'],
  'shop-act-udyam': ['मालकाची माहिती व व्यवसायाचे तपशील अचूक भरा. दुकानाचा फलक, फोटो व सही स्पष्ट दिसणे आवश्यक आहे. / Enter accurate owner and business details; the shop board, photo and signature must be clearly visible.'],
  'caste-validity': [
    'जातीच्या जुन्या पुराव्याचा कालावधी: OBC / SEBC / SBC साठी १९६७ पूर्वीचा; VJNT साठी १९६१ पूर्वीचा; SC / ST साठी १९५० पूर्वीचा. / Historical proof: OBC / SEBC / SBC before 1967; VJNT before 1961; SC / ST before 1950.',
    'कुटुंबातील सदस्याकडे जात वैधता प्रमाणपत्र असल्यासच ते अपलोड करा. / Upload the family member caste validity record only if one exists.',
    'नातेवाईकाचा पुरावा आजोबा, आत्या किंवा काका यांचा असू शकतो. जुना महसुली पुरावा म्हणून मालमत्ता पत्रक, घर आकारणी किंवा मतदार यादी वापरता येईल. / Relative proof may belong to a grandfather, aunt or uncle; historical revenue proof can be a property card, house assessment or electoral roll.'
  ],
  'ews-certificate': [
    'दिलेल्या संदर्भ फॉर्मनुसार प्रमाणपत्राचा कालावधी १ एप्रिल २०२६ ते ३१ मार्च २०२७ आहे. / The supplied reference form lists the certificate period as 1 April 2026 to 31 March 2027.',
    'जुन्या पुराव्यांसाठी नातेवाईकाचा शाळा सोडल्याचा दाखला तसेच जुना आकारणी उतारा, ७/१२ उतारा किंवा मालमत्ता पत्रक वापरता येईल. / Historical proofs can include a relative school leaving certificate and an old assessment extract, 7/12 extract or property card.'
  ],
  'food-license': ['परवान्याचा कालावधी व व्यवसायाचा प्रकार निवडा. व्यवसायाच्या आतील व बाहेरील भागाचे स्पष्ट फोटो अपलोड करा. / Choose the licence duration and business category, and upload clear photos of the business inside and outside.'],
  'passport': ['नाव, जन्मस्थळ व कुटुंबातील सदस्यांची माहिती कागदपत्रांप्रमाणे अचूक भरा. / Enter the name, birthplace and family details exactly as shown in the supporting documents.'],
  'voting-card': ['अर्जदाराचे आधार कार्ड व स्पष्ट फोटो अपलोड करा. / Upload the applicant Aadhaar card and a clear photograph.'],
  'pan': ['जन्म दाखला, वाहनचालक परवाना किंवा मतदार ओळखपत्र यापैकी जन्मतारीख नमूद असलेला कोणताही एक पुरावा अपलोड करा. / Upload any one date-of-birth proof: birth certificate, driving licence or voter ID showing the date of birth.'],
  'pf-assistance': ['पासवर्ड येथे भरू नका किंवा अपलोड करू नका. मदत घेताना ग्राहकाने अधिकृत पोर्टलवर स्वतः पासवर्ड भरावा. / Do not enter, upload or save a password here; the customer should enter it directly in the official portal during the assisted session.'],
  'ration-card': [
    'सर्व सदस्यांची आधार कार्डे, पॅन कार्डे व फोटो अपलोड करा. / Upload Aadhaar cards, PAN cards and photos for all members.',
    'युनिट कमी करताना मृत्यू प्रमाणपत्र / विवाह प्रमाणपत्र आवश्यक आहे. युनिट वाढवताना नाव बदलाचा पुरावा / जन्म दाखला आवश्यक आहे. / A unit decrease needs a death or marriage certificate; a unit increase needs a name-change record or birth certificate.'
  ]
};
for (const service of serviceCatalog) {
  for (const document of service.documents) document.marathiLabel ||= marathiDocuments[document.label];
  for (const document of service.documents) {
    if (/^(?:(Applicant|Father|Owner) )?(?:Live )?Photo$/.test(document.label)) {
      document.displayLabel = document.label === 'Photo' ? 'Live Photo' : document.label.replace(/(?<!Live )Photo$/, 'Live Photo');
      document.note = service.slug === 'caste-certificate'
        ? 'Upload a photo clicked at the moment.'
        : 'Upload a photo clicked at the moment. / आत्ताच काढलेला फोटो अपलोड करा.';
      document.marathiLabel = `${document.label.startsWith('Father') ? 'वडिलांचा' : document.label.startsWith('Owner') ? 'मालकाचा' : 'अर्जदाराचा'} आत्ताच काढलेला फोटो (Live Photo)`;
    }
  }
  if (serviceNotes[service.slug]) service.instructions = serviceNotes[service.slug].join('\n');
}
