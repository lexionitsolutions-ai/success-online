const doc = (label, note = '', when) => ({ label, required: true, note, ...(when ? { when } : {}) });
const field = (label, type = 'text', options) => ({ label, type, ...(options ? { options } : {}) });
const gazetteNameFields = language => ['Old', 'New'].flatMap(kind =>
  ['First name', 'Father name', 'Last name'].map((part, index) => ({
    ...field(`${kind} ${part.toLowerCase()} (${language})`), required: true,
    displayLabel: language === 'Marathi' ? ['पहिले नाव', 'वडिलांचे नाव', 'आडनाव'][index] : ['First Name', 'Father’s Name', kind === 'Old' ? 'Surname' : 'Last Name'][index],
    section: language === 'Marathi' ? (kind === 'Old' ? 'जुने नाव' : 'नवीन नाव') : (kind === 'Old' ? 'From Name' : 'To Name'),
    sectionNote: language === 'Marathi' ? 'मराठीत टाइप करा. English अक्षरांत नाव टाइप करून Space दाबा. उदा. raama → राम, paaTiila → पाटील. थेट मराठी कीबोर्डही वापरू शकता.' : (kind === 'Old' ? 'Enter your old name as shown on your documents.' : 'Enter the new name you want on the Gazette.'),
    ...(language === 'Marathi' ? { marathiInput: true } : {}),
    when: { field: 'Gazette language', equals: language }
  })));
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
    name: 'Caste Certificate', slug: 'caste-certificate', description: 'Caste certificate application assistance.', serviceCharge: 40000,
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
    name: 'Gazette', slug: 'gazette', description: 'Gazette application assistance.',
    fields: [
      { ...field('Gazette language', 'select', ['English', 'Marathi']), displayLabel: 'Would you like your Gazette in English or Marathi? / आपल्याला गॅझेट इंग्रजीत हवे आहे की मराठीत?', optionLabels: { English: 'English / इंग्रजी', Marathi: 'Marathi / मराठी' } },
      { ...field('Reason for name change', 'select', ['Marriage', 'Correction of incorrect name', 'Other name change']), displayLabel: 'Why are you changing your name? / आपण नाव का बदलत आहात?', optionLabels: { Marriage: 'Marriage / विवाहामुळे', 'Correction of incorrect name': 'Correction of incorrect name / चुकीच्या नावाची दुरुस्ती', 'Other name change': 'Other name change / इतर कारणाने नाव बदल' } },
      ...gazetteNameFields('English'), ...gazetteNameFields('Marathi')
    ],
    documents: [
      doc('Aadhaar Card'), doc('PAN Card'), doc('School Leaving Certificate'), doc('Photo'),
      doc('Wedding Invitation / Marriage Registration Certificate', 'Upload either a wedding invitation or a marriage registration certificate for a name change due to marriage.', { field: 'Reason for name change', equals: 'Marriage' }),
      doc('Husband Aadhaar Card', 'Required for a name change due to marriage.', { field: 'Reason for name change', equals: 'Marriage' }),
      doc('Correct Name Proof / Affidavit', 'Upload either proof of the correct name or an affidavit for correction of an incorrect name.', { field: 'Reason for name change', equals: 'Correction of incorrect name' })
    ]
  },
  {
    name: 'Police Clearance Certificate', slug: 'police-clearance', description: 'Police clearance certificate application assistance.', serviceCharge: 30000,
    instructions: 'Provide the names and contact numbers of two people known to the applicant. Upload any one school leaving, birth, or SSC certificate, and either an office letter or a self declaration. Upload a live photo and a signature on white paper.',
    fields: [
      field('Police Station'),
      { ...field('Reason for clearance', 'select', ['Job', 'Tour', 'Education', 'Visa / Immigration', 'Business']), required: true },
      { ...field('Company or organisation name'), fullWidth: true },
      ...[1, 2].flatMap(person => [
        { ...field(`Reference ${person} name`), displayLabel: 'Full name (required)', required: true, section: `Reference person ${person}`, sectionNote: 'Enter the details of a person known to the applicant.' },
        { ...field(`Reference ${person} contact number`, 'tel'), displayLabel: 'Contact number (required)', required: true, section: `Reference person ${person}`, inputMode: 'numeric', pattern: '[0-9]{10}', placeholder: '10-digit contact number' }
      ])
    ],
    documents: [
      doc('Aadhaar Card'), doc('PAN Card'),
      { ...doc('School Leaving Certificate', 'Upload any ONE: School Leaving Certificate, Birth Certificate, or SSC Certificate.'), displayLabel: 'School Leaving / Birth / SSC Certificate', marathiLabel: 'शाळा सोडल्याचा दाखला / जन्म दाखला / दहावीचे प्रमाणपत्र (कोणतेही एक)' },
      { ...doc('Photo', 'Upload a recent live photo of the applicant.'), displayLabel: 'Live Photo' },
      { ...doc('Electricity Bill'), displayLabel: 'Electricity Bill / Light Bill' },
      { ...doc('Office Letter / NOC', 'Upload either an Office Letter or a Self Declaration.'), displayLabel: 'Office Letter / Self Declaration', marathiLabel: 'कार्यालयाचे पत्र / स्वयंघोषणापत्र (कोणतेही एक)' },
      { ...doc('Signature on White Paper', 'Upload the applicant\'s signature on plain white paper.'), marathiLabel: 'पांढऱ्या कागदावरील अर्जदाराची सही' }
    ]
  },
  {
    name: 'Shop Act', slug: 'shop-act', description: 'Shop Act registration application assistance.',
    fields: [
      { ...field('Shop name'), required: true, allowNumbers: true, displayLabel: 'शॉपचे नाव काय आहे? / What is the shop name?' },
      { ...field('Business email', 'email'), required: true, displayLabel: 'ईमेल आयडी काय आहे? / What is the email address?' },
      { ...field('Business start date', 'date'), required: true, displayLabel: 'दुकान कधी सुरू झाले? / When did the shop open?' },
      { ...field('Shop address'), required: true, fullWidth: true, displayLabel: 'दुकानाचा संपूर्ण पत्ता काय आहे? / What is the full shop address?' },
      { ...field('Owned or rented', 'select', ['Owned', 'Rented']), required: true, displayLabel: 'दुकान स्वतःचे आहे की भाड्याने? / Are the shop premises owned or rented?', optionLabels: { Owned: 'स्वतःचे / Owned', Rented: 'भाड्याने / Rented' } },
      { ...field('Male workers', 'number'), required: true, min: 0, step: '1', displayLabel: 'पुरुष कामगार किती आहेत? / How many male workers are there?' },
      { ...field('Female workers', 'number'), required: true, min: 0, step: '1', displayLabel: 'महिला कामगार किती आहेत? / How many female workers are there?' },
      { ...field('Number of workers', 'number'), computedSum: ['Male workers', 'Female workers'], displayLabel: 'एकूण कामगार संख्या / Total number of workers' },
      { ...field('Business type'), required: true, displayLabel: 'व्यवसायाचे स्वरूप काय आहे? / What does the business do?', placeholder: 'उदा. किराणा दुकान, कपड्यांचे दुकान / e.g. Grocery shop, clothing shop' },
      { ...field('Business mobile number', 'tel'), required: true, inputMode: 'numeric', pattern: '[6-9][0-9]{9}', displayLabel: 'मोबाईल नंबर काय आहे? / What is the mobile number?', placeholder: '10 अंकी मोबाईल नंबर / 10-digit mobile number' },
      { ...field('Ownership type', 'select', ['Individual', 'Partnership']), required: true, displayLabel: 'व्यवसाय वैयक्तिक आहे की भागीदारीत? / Is the business individually owned or a partnership?', optionLabels: { Individual: 'वैयक्तिक / Individual', Partnership: 'भागीदारी / Partnership' } },
      { ...field('Owner / partner names'), required: true, fullWidth: true, displayLabel: 'मालकाचे नाव काय आहे? भागीदारी असल्यास सर्व भागीदारांची नावे लिहा. / Enter the owner name, or all partner names for a partnership.' },
      { ...field('Years at Aadhaar address', 'number'), required: true, min: 0, step: '1', displayLabel: 'आधारकार्डवरील पत्त्यावर किती वर्षे राहता? / How many years have you lived at the Aadhaar address?' },
      { ...field('Shop size (sq. ft.)', 'number'), required: true, min: 0.01, step: '0.01', displayLabel: 'दुकान / गाळ्याचे क्षेत्रफळ किती चौ. फूट आहे? / What is the shop area in square feet?' },
      { ...field('Business investment', 'number'), required: true, min: 0, step: '0.01', displayLabel: 'व्यवसायात किती गुंतवणूक केली आहे (रु.)? / How much is invested in the business (Rs)?' },
      { ...field('GST registered?', 'select', ['Yes', 'No']), required: true, displayLabel: 'GST नंबर आहे का? / Do you have a GST number?', optionLabels: { Yes: 'होय / Yes', No: 'नाही / No' } },
      { ...field('GST number'), required: true, when: { field: 'GST registered?', equals: 'Yes' }, displayLabel: 'GST नंबर काय आहे? / What is the GST number?' }
    ],
    documents: [
      ...['Owner Aadhaar Card', 'Owner Photo', 'Owner Signature Image', 'Owner PAN Card'].map(label => ({ ...doc(label, 'Upload this document for the owner and EVERY partner, if in partnership. Add separate files or a combined PDF. / मालकाची व भागीदारी असल्यास प्रत्येक भागीदाराची कागदपत्रे अपलोड करा.'), multiple: true })),
      { ...doc('Owner Bank Passbook / Cheque', 'Upload a bank passbook or cheque for the owner and every partner. / मालकाचे व प्रत्येक भागीदाराचे बँक पासबुक किंवा चेक अपलोड करा.'), multiple: true, marathiLabel: 'मालकाचे / सर्व भागीदारांचे बँक पासबुक किंवा चेक' },
      doc('Shop Board Photo'),
      { ...doc('Firm PAN Card', 'Required for a partnership firm. / भागीदारी फर्मसाठी आवश्यक.', { field: 'Ownership type', equals: 'Partnership' }), marathiLabel: 'भागीदारी फर्मचे पॅन कार्ड' }
    ]
  },
  {
    name: 'Udyam Aadhaar Certificate', slug: 'udyam-aadhaar', description: 'Udyam Aadhaar registration application assistance.',
    fields: [], documents: [] // Populated from the shared business questions below.
  },
  {
    name: 'Caste Validity Certificate', slug: 'caste-validity', description: 'Caste validity certificate application assistance.',
    fields: [
      { ...field('Caste Validity Certificate required for', 'select', ['Job', 'Education', 'Election']), required: true, displayLabel: 'Caste Validity Certificate required for / जात वैधता प्रमाणपत्र कशासाठी आवश्यक आहे?' },
      { ...field('Applicant under 18?', 'select', ['Yes', 'No']), required: true, displayLabel: 'Is the applicant under 18? / अर्जदाराचे वय १८ वर्षांपेक्षा कमी आहे का?', optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' } }
    ],
    documents: [
      ...[doc('Applicant Aadhaar Card'), doc('Applicant School Leaving Certificate'), doc('Applicant Photo'), doc('Applicant Caste Certificate'), doc('Form 15A')].map(item => ({ ...item, section: 'Applicant / अर्जदार' })),
      ...[doc('Father School Leaving Certificate / Bonafide', 'Upload either a School Leaving Certificate or Bonafide. / शाळा सोडल्याचा दाखला किंवा बोनाफाईड अपलोड करा.'), doc('Ration Card'), doc('Father Photo'), doc('Father Aadhaar Card')].map(item => ({ ...item, section: 'Father / वडील' })),
      { ...doc('Relative School Leaving Certificate / Bonafide (pre-1967)', 'Upload a School Leaving Certificate or Bonafide of a grandfather, paternal aunt, or paternal uncle. / आजोबा, आत्या किंवा चुलते यांचा शाळा सोडल्याचा दाखला किंवा बोनाफाईड अपलोड करा.'), displayLabel: 'Grandfather / Aunt / Uncle - School Leaving Certificate / Bonafide', marathiLabel: 'आजोबा / आत्या / चुलते - शाळा सोडल्याचा दाखला / बोनाफाईड', section: 'Grandfather / Aunt / Uncle / आजोबा / आत्या / चुलते' },
      { ...doc('Historical Revenue Proof (pre-1967)', 'Upload any ONE: Property Card, House Assessment, or Electoral Roll. / प्रॉपर्टी कार्ड, घर आकारणी किंवा मतदान यादी यापैकी कोणताही एक पुरावा अपलोड करा.'), displayLabel: 'Property Card / House Assessment / Electoral Roll', marathiLabel: 'प्रॉपर्टी कार्ड / घर आकारणी / मतदान यादी (कोणतेही एक)', section: 'Revenue Proof / महसूल पुरावा' },
      { ...doc('Family Member Caste Validity Record', 'Upload only if a family member already has caste validity. / घरातील कोणाची जात पडताळणी झाली असल्यास प्रमाणपत्र अपलोड करा.'), required: false, section: 'Family Caste Validity (if available) / घरातील जात वैधता (असल्यास)' }
    ]
  },
  {
    name: 'EWS Certificate', slug: 'ews-certificate', description: 'EWS certificate application assistance.',
    instructions: 'The source PDF lists a certificate period of 1 April 2026 to 31 March 2027.',
    fields: [
      { ...field('EWS certificate type', 'select', ['Central', 'State']), required: true, displayLabel: 'Which type of EWS certificate do you need? / तुम्हाला कोणत्या प्रकारचे EWS प्रमाणपत्र हवे आहे?', optionLabels: { Central: 'Central / केंद्र', State: 'State / राज्य' } },
      { ...field('Applicant caste'), required: true, displayLabel: 'What is the applicant’s caste? / अर्जदाराची जात कोणती आहे?', placeholder: 'Enter the applicant’s caste / अर्जदाराची जात लिहा' },
      { ...field('Applicant under 18?', 'select', ['Yes', 'No']), required: true, displayLabel: 'Is the applicant under 18 years of age? / अर्जदाराचे वय १८ वर्षांपेक्षा कमी आहे का?', optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' } }
    ],
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

// Udyam has its own checklist; share wording and validation for common business questions.
const shopAct = serviceCatalog.find(service => service.slug === 'shop-act');
const udyam = serviceCatalog.find(service => service.slug === 'udyam-aadhaar');
udyam.fields = shopAct.fields
  .filter(item => !['Owned or rented', 'Male workers', 'Female workers', 'Years at Aadhaar address', 'Shop size (sq. ft.)'].includes(item.label))
  .map(item => item.label === 'Number of workers'
    ? { ...field('Number of workers', 'number'), required: true, min: 0, step: '1', displayLabel: 'एकूण कामगार किती आहेत? / How many workers are there?' }
    : { ...item });
udyam.documents = shopAct.documents.filter(item => item.label !== 'Shop Board Photo').map(item => ({ ...item }));

// Model conditional proofs as separate checklist items so each can be validated.
serviceCatalog.find(service => service.slug === 'caste-certificate').documents.push(doc('Income Certificate'));
for (const slug of ['caste-certificate','non-creamy-layer']) {
  serviceCatalog.find(service => service.slug === slug).documents.push(doc('Father Aadhaar Card', 'Required for applicants under 18.', { field:'Applicant under 18?', equals:'Yes' }));
}

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
  'Wedding Invitation / Marriage Registration Certificate': 'लग्नपत्रिका / विवाह नोंदणी प्रमाणपत्र',
  'Husband Aadhaar Card': 'पतीचे आधार कार्ड',
  'Correct Name Proof / Affidavit': 'अचूक नावाचा पुरावा / प्रतिज्ञापत्र',
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
  'gazette': [
    'आधार कार्ड, पॅन कार्ड, शाळा सोडल्याचा दाखला आणि फोटो आवश्यक आहेत. / Aadhaar Card, PAN Card, School Leaving Certificate and Photo are required.',
    'विवाहामुळे नाव बदलत असल्यास लग्नपत्रिका किंवा विवाह नोंदणी प्रमाणपत्र आणि पतीचे आधार कार्ड अपलोड करा. / For a name change due to marriage, upload a Wedding Invitation or Marriage Registration Certificate, and the Husband Aadhaar Card.',
    'चुकीच्या नावाची दुरुस्ती असल्यास अचूक नावाचा पुरावा किंवा प्रतिज्ञापत्र अपलोड करा. / For correction of an incorrect name, upload Correct Name Proof or an Affidavit.'
  ],
  'police-clearance': ['अर्जदाराला ओळखणाऱ्या दोन व्यक्तींची नावे व संपर्क क्रमांक द्या. / Provide the names and contact numbers of two people known to the applicant.', 'शाळा सोडल्याचा दाखला, जन्म दाखला किंवा दहावीचे प्रमाणपत्र यापैकी कोणताही एक पुरावा अपलोड करा. / Upload any ONE: School Leaving Certificate, Birth Certificate, or SSC Certificate.', 'कार्यालयाचे पत्र किंवा स्वयंघोषणापत्र, आत्ताचा फोटो आणि पांढऱ्या कागदावरील सही अपलोड करा. / Upload either an Office Letter or a Self Declaration, a live photo, and a signature on white paper.'],
  'shop-act': ['दुकान व व्यवसायाची माहिती अचूक भरा. / Enter accurate shop and business details.', 'भागीदारी असल्यास सर्व भागीदारांची आधारकार्ड, फोटो, सही, पॅन कार्ड आणि बँक पासबुक किंवा चेक अपलोड करा. फर्मचे पॅन कार्डही आवश्यक आहे. / For a partnership, upload Aadhaar cards, photos, signatures, PAN cards and bank passbooks or cheques for every partner, plus the firm PAN card.', 'दुकानाच्या बोर्डाचा स्पष्ट फोटो अपलोड करा. / Upload a clear photo of the shop board.'],
  'udyam-aadhaar': ['शॉपचे नाव, ईमेल, दुकान सुरू झाल्याची तारीख, पत्ता, कामगार संख्या, व्यवसायाचे स्वरूप, मोबाईल नंबर व गुंतवणूक अचूक भरा. / Enter the shop name, email, opening date, address, worker count, business activity, mobile number and investment accurately.', 'मालकाचे आधारकार्ड, फोटो, सही, पॅन कार्ड आणि बँक पासबुक किंवा चेक अपलोड करा. भागीदारी असल्यास प्रत्येक भागीदाराची ही कागदपत्रे व फर्मचे पॅन कार्ड आवश्यक आहे. / Upload Aadhaar, photo, signature, PAN and a bank passbook or cheque for the owner and every partner. The firm PAN is also required for partnerships.', 'GST नंबर असल्यास होय निवडून नंबर भरा. / If you have a GST number, select Yes and enter it.'],
  'caste-validity': [
    'SEBC / SBC / OBC — १९६७ च्या आतील जन्म, जातीची नोंद व महसूल पुरावा. / Birth, caste entry and revenue proof dated before 1967.',
    'VJNT — १९६१ च्या आतील जन्म, जातीची नोंद व महसूल पुरावा. / Birth, caste entry and revenue proof dated before 1961.',
    'SC / ST — १९५० च्या आतील जन्म, जातीची नोंद व महसूल पुरावा. / Birth, caste entry and revenue proof dated before 1950.',
    'अर्जदार, वडील, नातेवाईक व महसूल पुरावा यांची कागदपत्रे संबंधित विभागात अपलोड करा. / Upload the applicant, father, relative and revenue documents in their respective sections.',
    'घरातील कोणाची जात पडताळणी झाली असल्यास त्यांचे जात वैधता प्रमाणपत्र अपलोड करा. / Upload a family member caste validity certificate if available.'
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
  if (['shop-act', 'udyam-aadhaar'].includes(service.slug)) {
    for (const document of service.documents.filter(document => document.multiple)) {
      document.displayLabel = (document.displayLabel || document.label).replace(/^Owner /, 'Owner / All Partners - ');
      if (document.label === 'Owner Photo') document.note += ' Upload a live photo of EVERY partner. / प्रत्येक भागीदाराचा आत्ताचा फोटो अपलोड करा.';
    }
  }
  if (serviceNotes[service.slug]) service.instructions = serviceNotes[service.slug].join('\n');
}
