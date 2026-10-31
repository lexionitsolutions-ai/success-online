const doc = (label, note = '', when) => ({ label, required: true, note, ...(when ? { when } : {}) });
const field = (label, type = 'text', options) => ({ label, type, ...(options ? { options } : {}) });
const gazetteNameFields = language => ['Old', 'New'].map(kind => ({
    ...field(`${kind} full name (${language})`), required: true, fullWidth: true,
    displayLabel: 'Full name / संपूर्ण नाव',
    section: kind === 'Old' ? 'Old name / जुने नाव' : 'New name / नवीन नाव',
    sectionNote: language === 'Marathi' ? 'संपूर्ण नाव मराठीत भरा. इंग्रजी अक्षरांत टाइप केल्यास लगेच मराठीत रूपांतर होईल. उदा. raama → राम, paaTiila → पाटील. मराठी कीबोर्डही वापरू शकता.' : (kind === 'Old' ? 'Enter your full old name as shown on your documents.' : 'Enter your full new name for the Gazette.'),
    ...(language === 'Marathi' ? { marathiInput: true } : {}),
    when: { field: 'Gazette language', equals: language }
  }));
const incomeAmount = label => ({ ...field(label, 'number'), min: 0, step: '0.01', inputMode: 'decimal', placeholder: 'e.g. 150000' });
const today = new Date();
const financialYear = Number(today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric' })) - (Number(today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric' })) < 4 ? 1 : 0);
const incomeYears = ['2021-2022', '2022-2023', '2023-2024'];
const singleIncomeYear = `${financialYear - 1}-${financialYear}`;
const rationYes = label => ({ field: label, equals: 'Yes', defaultValue: 'No' });
const rationProof = (label, marathiLabel, note = '', when, section = 'Common Documents / अनिवार्य कागदपत्रे') => ({ ...doc(label, note, when), displayLabel: `${label} / ${marathiLabel}`, marathiLabel, section });

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
      { ...field('Birth certificate address'), displayLabel: 'Full address as on Birth Certificate / जन्म दाखल्यावरील संपूर्ण पत्ता', placeholder: 'Address, city and state as shown on the Birth Certificate', required: true, fullWidth: true, when: { field: 'Is beneficiary birth place in Maharashtra?', equals: 'No' } }
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
    documents: [doc('Applicant Aadhaar Card', 'For applicants under 18, upload both applicant and father Aadhaar cards.'), doc('School Leaving Certificate'), doc('Photo'), doc('Caste Certificate'), { ...doc('3 Years Income Certificate', 'Upload the income certificate covering all three years. / तीन वर्षांचे उत्पन्न प्रमाणपत्र अपलोड करा.'), marathiLabel: 'तीन वर्षांचे उत्पन्न प्रमाणपत्र', multiple: true }]
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
        { ...field(`Reference ${person} contact number`, 'tel'), displayLabel: 'Contact number (required)', required: true, section: `Reference person ${person}`, inputMode: 'numeric', digitsOnly: true, maxLength: 10, pattern: '[0-9]{10}', placeholder: '10-digit contact number' }
      ])
    ],
    documents: [
      doc('Aadhaar Card'), doc('PAN Card'),
      { ...doc('School Leaving Certificate', 'Upload any ONE: School Leaving Certificate, Birth Certificate, or SSC Certificate.'), displayLabel: 'School Leaving / Birth / SSC Certificate', marathiLabel: 'शाळा सोडल्याचा दाखला / जन्म दाखला / दहावीचे प्रमाणपत्र (कोणतेही एक)' },
      { ...doc('Photo', 'Upload a recent live photo of the applicant.'), displayLabel: 'Live Photo' },
      { ...doc('Electricity Bill'), displayLabel: 'Electricity Bill / Light Bill' },
      { ...doc('Office Letter / NOC', 'Print and fill in the supplied police clearance form (PCC ARJ), then upload the completed document in the Documents section. You may upload an Office Letter or Self Declaration instead. / दिलेल्या पोलीस पडताळणी अर्जाची (PCC ARJ) प्रिंट काढून माहिती भरा आणि पूर्ण केलेला अर्ज कागदपत्रे विभागात अपलोड करा. त्याऐवजी कार्यालयाचे पत्र किंवा स्वयंघोषणापत्रही अपलोड करू शकता.'), displayLabel: 'Office Letter / Self Declaration', marathiLabel: 'कार्यालयाचे पत्र / स्वयंघोषणापत्र (कोणतेही एक)', templateUrl: '/downloads/police-clearance-form.pdf', templateTitle: 'Police Clearance Form (PCC ARJ) / पोलीस पडताळणी अर्ज', formInstructions: 'Download, print and fill in the supplied PCC ARJ form. Upload the completed document under Office Letter / Self Declaration in the Documents section. / दिलेला PCC ARJ फॉर्म डाउनलोड करून प्रिंट काढा व संपूर्ण माहिती भरा. पूर्ण केलेला अर्ज कागदपत्रे विभागातील कार्यालयाचे पत्र / स्वयंघोषणापत्र या पर्यायात अपलोड करा.' },
      { ...doc('Signature on White Paper', 'Upload the applicant\'s signature on plain white paper.'), marathiLabel: 'पांढऱ्या कागदावरील अर्जदाराची सही' }
    ]
  },
  {
    name: 'Shop Act Registration', slug: 'shop-act', description: 'Shop Act registration application assistance.',
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
      { ...doc('Electricity Bill', 'Required for owned premises. / दुकान स्वतःचे असल्यास आवश्यक.', { field: 'Owned or rented', equals: 'Owned' }), displayLabel: 'Light Bill / वीज बिल' },
      doc('Rent Agreement', 'Required for rented premises. / दुकान भाड्याने असल्यास आवश्यक.', { field: 'Owned or rented', equals: 'Rented' }),
      doc('Partnership Deed', 'Required for a partnership. / भागीदारी व्यवसाय असल्यास आवश्यक.', { field: 'Ownership type', equals: 'Partnership' }),
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
      { ...doc('Completed Caste Validity Information Form', 'Download and print the form, fill it in by hand, then upload the completed document in the Documents section. / फॉर्म डाउनलोड करून प्रिंट काढा, हाताने संपूर्ण माहिती भरा आणि भरलेला फॉर्म कागदपत्रे विभागात अपलोड करा.'), marathiLabel: 'भरलेला जात वैधता माहिती फॉर्म', templateUrl: '/downloads/caste-validity-information-form.pdf', multiple: true, section: 'Applicant / अर्जदार' },
      ...[doc('Father School Leaving Certificate / Bonafide', 'Upload either a School Leaving Certificate or Bonafide. / शाळा सोडल्याचा दाखला किंवा बोनाफाईड अपलोड करा.'), doc('Ration Card'), doc('Father Photo'), doc('Father Aadhaar Card')].map(item => ({ ...item, section: 'Father / वडील' })),
      { ...doc('Relative School Leaving Certificate / Bonafide (pre-1967)', 'Upload a School Leaving Certificate or Bonafide of a grandfather, paternal aunt, or paternal uncle. / आजोबा, आत्या किंवा चुलते यांचा शाळा सोडल्याचा दाखला किंवा बोनाफाईड अपलोड करा.'), displayLabel: 'Grandfather / Aunt / Uncle - School Leaving Certificate / Bonafide', marathiLabel: 'आजोबा / आत्या / चुलते - शाळा सोडल्याचा दाखला / बोनाफाईड', section: 'Grandfather / Aunt / Uncle / आजोबा / आत्या / चुलते' },
      { ...doc('Historical Revenue Proof (pre-1967)', 'Upload any ONE: Property Card, House Assessment, or Electoral Roll. / प्रॉपर्टी कार्ड, घर आकारणी किंवा मतदान यादी यापैकी कोणताही एक पुरावा अपलोड करा.'), displayLabel: 'Property Card / House Assessment / Electoral Roll', marathiLabel: 'प्रॉपर्टी कार्ड / घर आकारणी / मतदान यादी (कोणतेही एक)', section: 'Revenue Proof / महसूल पुरावा', highlightedNotes: [
        { number: 10, marathi: 'चालू वर्षाचा घराचा असेसमेंट उतारा (एकूण क्षेत्रफळ १००० चौ. फुटांच्या आत असणे आवश्यक).', english: 'Current house assessment extract (the total area must be less than 1,000 sq. ft.).' },
        { number: 11, marathi: 'वडिलांचे आधार कार्ड (अर्जदाराचे वय १८ वर्षांपेक्षा कमी असल्यास आवश्यक).', english: 'Father’s Aadhaar card (required if the applicant is under 18 years of age).' }
      ] },
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
    documents: [
      doc('Aadhaar Card'), doc('Ration Card'), doc('Photo'), doc('Applicant School Leaving Certificate'), doc('Income Certificate'), doc('Residence Certificate'), doc('Father School Leaving Certificate'),
      { ...doc('Relative School Leaving Certificate (pre-1967)', 'Upload the school leaving certificate of the grandfather or great-grandfather. / आजोबा किंवा पणजोबांचा शाळा सोडल्याचा दाखला अपलोड करा.'), displayLabel: 'Grandfather / Great-grandfather School Leaving Certificate', marathiLabel: 'आजोबा / पणजोबांचा शाळा सोडल्याचा दाखला' },
      doc('Historical Revenue Proof (pre-1967)', 'Old assessment extract, 7/12 extract, or property card.'),
      doc('Current Assessment Extract', 'The area stated in the assessment extract must be less than 1,000 square feet. / ॲसेसमेंट उताऱ्यात दिलेले क्षेत्रफळ एक हजार स्क्वेअर फुटांच्या (१००० चौ. फूट) आत असले पाहिजे.'),
      { ...doc('Other Document', 'Optional: Upload any additional supporting documents, if available. / ऐच्छिक: इतर कोणतीही सहाय्यक कागदपत्रे उपलब्ध असल्यास अपलोड करा.'), required: false, marathiLabel: 'इतर कागदपत्रे (ऐच्छिक)', multiple: true }
    ]
  },
  {
    name: 'Food License', slug: 'food-license', description: 'Food licence application assistance.',
    fields: [field('Licence duration', 'select', ['1 year', '2 years', '3 years', '4 years', '5 years']), field('Business category', 'select', ['Service', 'Retail', 'Manufacturing'])],
    documents: [doc('Aadhaar Card'), doc('Photo'), doc('Electricity Bill'), doc('Rent Agreement'), doc('Property Tax Record'), doc('PAN Card'), doc('Business Photos (inside and outside)')]
  },
  {
    name: 'Passport', slug: 'passport', description: 'Passport application assistance.',
    fields: [
      { ...field('Mobile', 'tel'), required: true, displayLabel: 'Mobile number / मोबाईल नंबर', inputMode: 'numeric', digitsOnly: true, maxLength: 10, pattern: '[6-9][0-9]{9}', placeholder: '10-digit mobile number / १० अंकी मोबाईल नंबर' },
      { ...field('Email', 'email'), required: true, displayLabel: 'Email address / ईमेल पत्ता' },
      { ...field('Birth place'), required: true, displayLabel: 'Birth place / जन्मस्थान' },
      { ...field('Police station'), required: true, displayLabel: 'Police station / पोलीस ठाणे' },
      { ...field('Emergency number', 'tel'), required: true, displayLabel: 'Emergency number / आपत्कालीन संपर्क क्रमांक', inputMode: 'numeric', digitsOnly: true, maxLength: 10, pattern: '[6-9][0-9]{9}', placeholder: '10-digit mobile number / १० अंकी मोबाईल नंबर' },
      { ...field('Mother name'), required: true, displayLabel: 'Mother name / आईचे नाव' },
      { ...field('Father name'), required: true, displayLabel: 'Father name / वडिलांचे नाव' },
      { ...field('Wife name'), required: false, displayLabel: 'Wife name (optional) / पत्नीचे नाव (ऐच्छिक)', placeholder: 'Leave blank if not applicable / लागू नसल्यास रिकामे ठेवा' },
      { ...field('Education'), required: true, displayLabel: 'Education / शिक्षण' },
      { ...field('Occupation', 'select', ['Employee', 'Government Employee', 'Self-employed', 'Student', 'Retailer']), required: true, displayLabel: 'Occupation / व्यवसाय', optionLabels: { Employee: 'Employee / नोकरदार', 'Government Employee': 'Government Employee / शासकीय कर्मचारी', 'Self-employed': 'Self-employed / स्वयंरोजगार', Student: 'Student / विद्यार्थी', Retailer: 'Retailer / किरकोळ विक्रेता' } },
      { ...field('Passport application type', 'select', ['New', 'Renew']), required: true, fullWidth: true, displayLabel: 'Are you applying for a new passport or renewing an existing passport? / तुम्हाला नवीन पासपोर्ट काढायचा आहे की सध्याच्या पासपोर्टचे नूतनीकरण करायचे आहे?', optionLabels: { New: 'New / नवीन', Renew: 'Renew / नूतनीकरण' } },
      { ...field('Applicant under 18?', 'select', ['Yes', 'No']), required: true, fullWidth: true, displayLabel: 'Is the applicant under 18 years of age? / अर्जदाराचे वय १८ वर्षांपेक्षा कमी आहे का?', optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' } },
      { ...field('Name change or correction?', 'select', ['Yes', 'No']), required: true, fullWidth: true, displayLabel: 'Name spelling correction or change after marriage? / नावातील स्पेलिंग दुरुस्ती किंवा लग्नानंतर नाव बदलायचे आहे का?', optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' }, note: 'If Yes, enter the old name below and upload proof of the new or corrected name, such as a Gazette notification or an updated Aadhaar card, in Documents. / होय निवडल्यास, खाली जुने नाव भरा आणि नवीन किंवा दुरुस्त नावाचा पुरावा, उदा. राजपत्र (गॅझेट) किंवा अद्ययावत आधार कार्ड, कागदपत्रे विभागात अपलोड करा.' },
      { ...field('Old name'), required: true, displayLabel: 'Old name / जुने नाव', when: { field: 'Name change or correction?', equals: 'Yes' } }
    ],
    documents: [doc('Aadhaar Card'), doc('PAN Card'),
      { ...doc('Old Passport', 'Upload your existing / old passport for renewal. / नूतनीकरणासाठी तुमचा सध्याचा / जुना पासपोर्ट अपलोड करा.', { field: 'Passport application type', equals: 'Renew' }), displayLabel: 'Old Passport / जुना पासपोर्ट', multiple: true },
      { ...doc('Name Change / Correction Proof', 'Upload any ONE document confirming the new or corrected name, such as a Gazette notification or an updated Aadhaar card. / नवीन किंवा दुरुस्त नावाची पुष्टी करणारा कोणताही एक पुरावा, उदा. राजपत्र (गॅझेट) किंवा अद्ययावत आधार कार्ड, अपलोड करा.', { field: 'Name change or correction?', equals: 'Yes' }), displayLabel: 'Name Change / Correction Proof / नाव बदलाचा किंवा दुरुस्तीचा पुरावा' }
    ]
  },
  {
    name: 'Voting Card', slug: 'voting-card', description: 'Voter ID card application assistance.',
    fields: [
      { ...field('Mobile', 'tel'), required: true, displayLabel: 'Mobile number / मोबाईल नंबर', inputMode: 'numeric', digitsOnly: true, maxLength: 10, pattern: '[6-9][0-9]{9}', placeholder: '10-digit mobile number / १० अंकी मोबाईल नंबर' },
      { ...field('Voting card application type', 'select', ['New', 'Correction']), required: true, fullWidth: true, displayLabel: 'New voting card or correction? / नवीन मतदार ओळखपत्र की दुरुस्ती?', optionLabels: { New: 'New voting card / नवीन मतदार ओळखपत्र', Correction: 'Correction in voting card / मतदार ओळखपत्रात दुरुस्ती' } },
      { ...field('Voting card field to correct', 'select', ['Name', 'Gender', 'Date of birth / Age', 'Relationship type', 'Relative name', 'Address', 'Mobile number', 'Photograph']), required: true, fullWidth: true, when: { field: 'Voting card application type', equals: 'Correction' }, displayLabel: 'Which detail needs to be corrected? / कोणत्या माहितीत दुरुस्ती करायची आहे?', optionLabels: { Name: 'Name / नाव', Gender: 'Gender / लिंग', 'Date of birth / Age': 'Date of birth / Age / जन्मतारीख / वय', 'Relationship type': 'Relationship type (father / mother / spouse) / नात्याचा प्रकार (वडील / आई / पती किंवा पत्नी)', 'Relative name': 'Relative’s name / नातेवाईकाचे नाव', Address: 'Address / पत्ता', 'Mobile number': 'Mobile number / मोबाईल नंबर', Photograph: 'Photograph / छायाचित्र' }, note: 'Choose the detail that is incorrect, then enter the correct information below. For a photograph change, describe the change and upload the new photograph in Documents. / चुकीची माहिती निवडा आणि खाली योग्य माहिती भरा. छायाचित्र बदलायचे असल्यास बदलाचे वर्णन करा व कागदपत्रे विभागात नवीन छायाचित्र अपलोड करा.' },
      ...[
        ['Name', 'Corrected applicant name', 'What should the applicant’s name be corrected to? / अर्जदाराचे योग्य नाव काय असावे?', 'Enter the full correct name / संपूर्ण योग्य नाव भरा'],
        ['Gender', 'Corrected gender', 'What should the gender be corrected to? / योग्य लिंग काय असावे?', 'e.g. Male, Female, Transgender / उदा. पुरुष, स्त्री, तृतीयपंथी'],
        ['Date of birth / Age', 'Corrected date of birth or age', 'What is the correct date of birth or age? / योग्य जन्मतारीख किंवा वय काय आहे?', 'DD/MM/YYYY or age in years / दिनांक/महिना/वर्ष किंवा पूर्ण वय'],
        ['Relationship type', 'Corrected relationship type', 'What is the correct relationship type? / नात्याचा योग्य प्रकार कोणता आहे?', 'e.g. Father, Mother, Husband, Wife / उदा. वडील, आई, पती, पत्नी'],
        ['Relative name', 'Corrected relative name', 'What should the relative’s name be corrected to? / नातेवाईकाचे योग्य नाव काय असावे?', 'Enter the relative’s full correct name / नातेवाईकाचे संपूर्ण योग्य नाव भरा'],
        ['Address', 'Corrected address', 'What is the correct full address? / योग्य संपूर्ण पत्ता काय आहे?', 'House, street, village/city, district, state and PIN code / घर, रस्ता, गाव/शहर, जिल्हा, राज्य व पिन कोड'],
        ['Mobile number', 'Corrected mobile number', 'What is the correct mobile number? / योग्य मोबाईल नंबर काय आहे?', '10-digit mobile number / १० अंकी मोबाईल नंबर'],
        ['Photograph', 'Photograph correction details', 'Describe the photograph change required. / छायाचित्रात कोणता बदल हवा आहे ते लिहा.', 'Describe the replacement photograph / नवीन छायाचित्राबद्दल माहिती लिहा']
      ].map(([choice, label, displayLabel, placeholder]) => ({ ...field(label, choice === 'Mobile number' ? 'tel' : 'text'), required: true, fullWidth: true, displayLabel, placeholder, when: { all: [{ field: 'Voting card application type', equals: 'Correction' }, { field: 'Voting card field to correct', equals: choice }] }, ...(choice === 'Mobile number' ? { digitsOnly: true, maxLength: 10, inputMode: 'numeric', pattern: '[6-9][0-9]{9}' } : {}) }))
    ],
    documents: [doc('Aadhaar Card'), doc('Photo'), { ...doc('Old Voting Card', 'Upload the old voting card that needs correction. / दुरुस्ती करायचे जुने मतदार ओळखपत्र अपलोड करा.', { field: 'Voting card application type', equals: 'Correction' }), displayLabel: 'Old / Previous Voting Card / जुने / पूर्वीचे मतदार ओळखपत्र', marathiLabel: 'जुने / पूर्वीचे मतदार ओळखपत्र', multiple: true }]
  },
  {
    name: 'PAN Card', slug: 'pan', description: 'PAN card application assistance.',
    documents: [doc('Aadhaar Card'), doc('Photo'), doc('Signature Image'), doc('Any One Date of Birth Proof', 'Birth certificate, driving licence, or voter ID card. Date of birth must be shown.')]
  },
  {
    name: 'PF Working (Provident Fund)', slug: 'pf-assistance', description: 'Provident Fund service requests.',
    fields: [
      { ...field('UAN No', 'text'), required: true, digitsOnly: true, maxLength: 12, inputMode: 'numeric', pattern: '[0-9]{12}', displayLabel: 'UAN No / यूएएन क्रमांक', placeholder: '12-digit UAN number / १२ अंकी यूएएन क्रमांक' },
      { ...field('Password', 'password'), required: true, sensitive: true, maxLength: 128, displayLabel: 'Password / पासवर्ड' },
      { ...field('PF work required', 'textarea'), required: true, fullWidth: true, displayLabel: 'What work would you like us to complete on your PF account? / तुमच्या पीएफ खात्याशी संबंधित कोणते काम करून हवे आहे?', placeholder: 'Describe the PF work you need / आवश्यक पीएफ कामाची माहिती लिहा' },
      { ...field('PF profile updated?', 'select', ['Yes', 'No']), required: true, displayLabel: 'Do you want to update your PF profile? / तुम्हाला तुमचे पीएफ प्रोफाइल अद्ययावत करायचे आहे का?', optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' } },
      { ...field('PF email', 'email'), required: true, displayLabel: 'Email address / ईमेल पत्ता', when: { field: 'PF profile updated?', equals: 'Yes' } }
    ],
    documents: [doc('Aadhaar Card'), doc('PAN Card'), doc('Photo'), doc('Bank Passbook'), { ...doc('Other Supporting Documents', 'Upload any additional documents needed for the requested PF work. This upload is optional. / आवश्यक पीएफ कामासाठी लागणारी इतर कागदपत्रे येथे अपलोड करा. ही कागदपत्रे ऐच्छिक आहेत.'), required: false, multiple: true, displayLabel: 'Other Documents (optional) / इतर कागदपत्रे (ऐच्छिक)', marathiLabel: 'इतर कागदपत्रे (ऐच्छिक)' }]
  },
  {
    name: 'Ration Card', slug: 'ration-card', description: 'Ration card member, unit, and detail update assistance.',
    fields: [
      ...[
        ['Add a member?', 'Do you want to add a member’s name (other than due to marriage)? / विवाहाव्यतिरिक्त इतर कारणासाठी रेशन कार्डमध्ये नाव वाढवायचे आहे का?'],
        ['Add a member due to marriage?', 'Do you want to add a member’s name due to marriage? / विवाहामुळे रेशन कार्डमध्ये नाव वाढवायचे आहे का?'],
        ['Remove a member?', 'Do you want to remove a member’s name (due to death or separation)? / मृत्यू किंवा विभक्त रेशन कार्ड करण्यासाठी नाव कमी करायचे आहे का?'],
        ['Remove a member due to marriage?', 'Do you want to remove a member’s name due to marriage? / विवाहामुळे रेशन कार्डमधून नाव कमी करायचे आहे का?'],
        ['Change ration card address?', 'Do you want to change the address on the ration card? / रेशन कार्डवरील पत्ता बदलायचा आहे का?']
      ].map(([label, displayLabel]) => ({ ...field(label, 'select', ['Yes', 'No']), optional: true, answerGroup: 'ration-card', fullWidth: true, displayLabel, optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' } })),
      { ...field('Ration card residence', 'select', ['Owned', 'Rented']), optional: true, answerGroup: 'ration-card', displayLabel: 'Do you live in your own home or a rented home? / तुम्ही स्वतःच्या घरात राहता की भाड्याच्या घरात?', optionLabels: { Owned: 'Owned / स्वतःचे घर', Rented: 'Rented / भाड्याचे घर' } },
      { ...field('Is the ration card white?', 'select', ['Yes', 'No']), optional: true, answerGroup: 'ration-card', displayLabel: 'Is your ration card white? / तुमचे रेशन कार्ड पांढरे आहे का?', optionLabels: { Yes: 'Yes / होय', No: 'No / नाही' }, note: 'Answer at least one question to continue. Leave questions that do not apply unanswered; their extra documents will not be required. / पुढे जाण्यासाठी किमान एका प्रश्नाचे उत्तर द्या. लागू नसलेले प्रश्न रिकामे ठेवू शकता; त्यांची अतिरिक्त कागदपत्रे आवश्यक नसतील.' }
    ],
    documents: [
      { ...rationProof('Ration Card', 'रेशन कार्ड', 'Upload all pages of the existing ration card. / सध्याच्या रेशन कार्डची सर्व पाने अपलोड करा.'), multiple: true },
      { ...rationProof('All Members Aadhaar Cards', 'रेशन कार्डमधील सर्व सदस्यांची आधार कार्डे', 'Upload Aadhaar cards for EVERY member of the ration card. Add separate files or a combined PDF. / रेशन कार्डमधील प्रत्येक सदस्याचे आधार कार्ड स्वतंत्र फाइल किंवा एकत्रित PDF मध्ये अपलोड करा.'), multiple: true },
      { ...rationProof('All Members PAN Cards', 'रेशन कार्डमधील सर्व सदस्यांची पॅन कार्डे', 'Upload PAN cards for EVERY member of the ration card. / रेशन कार्डमधील प्रत्येक सदस्याचे पॅन कार्ड अपलोड करा.'), multiple: true },
      { ...rationProof('All Members Photos', 'रेशन कार्डमधील सर्व सदस्यांचे फोटो', 'Upload a clear photo of EVERY member of the ration card. / रेशन कार्डमधील प्रत्येक सदस्याचा स्पष्ट फोटो अपलोड करा.'), multiple: true },
      rationProof('Electricity Bill', 'लाईट बिल', 'Upload the electricity bill for the residence. / राहत्या घराचे लाईट बिल अपलोड करा.', { field: 'Change ration card address?', equals: 'No', defaultValue: 'No' }),
      rationProof('Consent Letter / Rent Agreement', 'संमती पत्र / भाडेकरार', 'For a rented home, upload any ONE: the owner’s consent letter or the rent agreement. / भाड्याच्या घरासाठी घरमालकाचे संमती पत्र किंवा भाडेकरार यापैकी कोणताही एक पुरावा अपलोड करा.', { field: 'Ration card residence', equals: 'Rented', defaultValue: 'Owned' }),
      rationProof('Gas Passbook', 'गॅस पासबुक'),
      { ...rationProof('Ration Shop A.B.C. Certificate', 'अ.ब.क. दाखला (ABC Document)', 'This is the BAC Dakhla (ABC Document). Print it, fill it in, and obtain the signature and stamp from the ration retail store. Upload the completed, signed and stamped document in the Documents section. / हा अ.ब.क. दाखला आहे. प्रिंट काढून संपूर्ण माहिती भरा आणि रेशन दुकानातून सही व शिक्का घेऊन पूर्ण केलेला दाखला कागदपत्रे विभागात अपलोड करा.'), displayLabel: 'ABC Document', templateUrl: '/downloads/ration-card-abc-dakhla.pdf' },
      rationProof('Female Head Bank Passbook', 'रेशन कार्ड प्रमुख महिलेचे बँक पासबुक'),
      rationProof('ITR / Form 16 / Pension Statement', 'आयकर विवरणपत्र / फॉर्म १६ / पेन्शन स्टेटमेंट', 'For a white ration card, upload any ONE: ITR, Form 16 or pension statement. / पांढऱ्या रेशन कार्डसाठी आयकर विवरणपत्र (ITR), फॉर्म १६ किंवा पेन्शन स्टेटमेंट यापैकी कोणताही एक पुरावा अपलोड करा.', rationYes('Is the ration card white?')),
      { ...rationProof('Member Addition Aadhaar Card', 'नाव वाढवायच्या सदस्याचे आधार कार्ड', 'Upload the Aadhaar card of each member being added. / नाव वाढवायच्या प्रत्येक सदस्याचे आधार कार्ड अपलोड करा.', rationYes('Add a member?'), 'Member Addition / नाव वाढ'), multiple: true },
      { ...rationProof('Member Addition Birth Certificate', 'नाव वाढवायच्या सदस्याचा जन्म दाखला', 'Both Aadhaar and birth certificate are compulsory for a member addition. / नाव वाढवण्यासाठी आधार कार्ड व जन्म दाखला ही दोन्ही कागदपत्रे अनिवार्य आहेत.', rationYes('Add a member?'), 'Member Addition / नाव वाढ'), multiple: true },
      rationProof('Marriage Addition Aadhaar Card', 'विवाहामुळे नाव वाढवायच्या सदस्याचे आधार कार्ड', '', rationYes('Add a member due to marriage?'), 'Addition Due to Marriage / विवाहामुळे नाव वाढ'),
      rationProof('Marriage Addition Name Removal Certificate', 'नाव कमी केल्याचा दाखला', 'Upload the certificate confirming removal from the previous ration card. / पूर्वीच्या रेशन कार्डमधून नाव कमी केल्याचा दाखला अपलोड करा.', rationYes('Add a member due to marriage?'), 'Addition Due to Marriage / विवाहामुळे नाव वाढ'),
      rationProof('Marriage Addition Wedding Invitation', 'लग्न पत्रिका', '', rationYes('Add a member due to marriage?'), 'Addition Due to Marriage / विवाहामुळे नाव वाढ'),
      rationProof('Death Certificate / Separation Application', 'मृत्यू दाखला / विभक्त करण्याचा अर्ज', 'For a death, upload the death certificate. For a separate ration card, upload the separation application. / मृत्यू झाल्यास मृत्यू दाखला अपलोड करा. विभक्त रेशन कार्ड करायचे असल्यास विभक्त करण्याचा अर्ज अपलोड करा.', rationYes('Remove a member?'), 'Member Removal / नाव कमी'),
      rationProof('Marriage Removal Aadhaar Card', 'विवाहामुळे नाव कमी करायच्या सदस्याचे आधार कार्ड', '', rationYes('Remove a member due to marriage?'), 'Removal Due to Marriage / विवाहामुळे नाव कमी'),
      rationProof('Marriage Removal Wedding Invitation', 'लग्न पत्रिका', '', rationYes('Remove a member due to marriage?'), 'Removal Due to Marriage / विवाहामुळे नाव कमी'),
      rationProof('Address Change Proof', 'पत्ता बदलाचा पुरावा', 'Upload any ONE for the new address: electricity bill or property tax receipt. This also fulfils the common electricity/address proof requirement. / नवीन पत्त्याचे लाईट बिल किंवा घरफळा पावती यापैकी कोणताही एक पुरावा अपलोड करा. हाच पुरावा अनिवार्य लाईट बिल / पत्त्याच्या पुराव्यासाठीही ग्राह्य धरला जाईल.', rationYes('Change ration card address?'), 'Address Change / पत्ता बदल')
    ]
  }
];

// Udyam has its own checklist; share wording and validation for common business questions.
const shopAct = serviceCatalog.find(service => service.slug === 'shop-act');
const udyam = serviceCatalog.find(service => service.slug === 'udyam-aadhaar');
const businessFieldHeadings = {
  'Shop name': 'Shop name / दुकानाचे नाव',
  'Business email': 'Email address / ईमेल पत्ता',
  'Business start date': 'Business start date / व्यवसाय सुरू झाल्याची तारीख',
  'Shop address': 'Shop address / दुकानाचा पत्ता',
  'Owned or rented': 'Shop owned or rented / दुकान स्वतःचे की भाड्याने',
  'Male workers': 'Male workers / पुरुष कामगार',
  'Female workers': 'Female workers / महिला कामगार',
  'Number of workers': 'Total number of workers / एकूण कामगार संख्या',
  'Business type': 'Nature of business / व्यवसायाचे स्वरूप',
  'Business mobile number': 'Mobile number / मोबाईल नंबर',
  'Ownership type': 'Ownership type / मालकीचा प्रकार',
  'Owner / partner names': 'Owner / partner names / मालक / भागीदारांची नावे',
  'Years at Aadhaar address': 'Years at Aadhaar address / आधारवरील पत्त्यावर वास्तव्याची वर्षे',
  'Shop size (sq. ft.)': 'Shop area (sq. ft.) / दुकानाचे क्षेत्रफळ (चौ. फूट)',
  'Business investment': 'Business investment (Rs) / व्यवसायातील गुंतवणूक (रु.)',
  'GST registered?': 'GST registered? / जीएसटी नोंदणी आहे का?',
  'GST number': 'GST number / जीएसटी क्रमांक'
};
shopAct.fields = shopAct.fields.map(item => ({ ...item, displayLabel: businessFieldHeadings[item.label] }));
udyam.fields = shopAct.fields
  .filter(item => !['Years at Aadhaar address', 'Shop size (sq. ft.)'].includes(item.label))
  .map(item => ({ ...item, ...(item.label === 'Male workers' ? { displayLabel: 'No of male workers / पुरुष कामगार संख्या' } : item.label === 'Female workers' ? { displayLabel: 'No of female workers / महिला कामगार संख्या' } : {}) }));
udyam.documents = shopAct.documents.filter(item => item.label !== 'Shop Board Photo').map(item => ({ ...item }));
udyam.documents.push({ ...doc('Business Address Proof', 'Upload a document showing the business address, if available. / उपलब्ध असल्यास व्यवसायाचा पत्ता दर्शविणारे कागदपत्र अपलोड करा.'), required: false, marathiLabel: 'व्यवसायाच्या पत्त्याचा पुरावा', multiple: true });

// Food licence shares business details and owner/partner proofs with Shop Act.
const food = serviceCatalog.find(service => service.slug === 'food-license');
const foodFieldLabels = ['Shop name', 'Business email', 'Shop address', 'Owned or rented', 'Business type', 'Business mobile number', 'Ownership type', 'Owner / partner names', 'Business investment', 'GST registered?', 'GST number'];
food.fields.push(...shopAct.fields.filter(item => foodFieldLabels.includes(item.label)).map(item => ({ ...item,
  ...(item.label === 'Business type' ? { placeholder: 'उदा. उपाहारगृह, बेकरी, खाद्यपदार्थ विक्री / e.g. Restaurant, bakery, food retail' } : {})
})));
const foodFieldHeadings = {
  'Licence duration': 'Licence duration / परवान्याचा कालावधी',
  'Business category': 'Business type / व्यवसायाचा प्रकार',
  'Shop name': 'Shop name / दुकानाचे नाव',
  'Business email': 'Email ID / ईमेल आयडी',
  'Shop address': 'Shop address / दुकानाचा पत्ता',
  'Owned or rented': 'Shop owned or rented / दुकान स्वतःचे की भाड्याने',
  'Business type': 'Nature of business / व्यवसायाचे स्वरूप',
  'Business mobile number': 'Mobile number / मोबाईल नंबर',
  'Ownership type': 'Ownership type / मालकीचा प्रकार',
  'Owner / partner names': 'Owner / partner names / मालक / भागीदारांची नावे',
  'Business investment': 'Business investment / व्यवसायातील गुंतवणूक',
  'GST registered?': 'GST registered? / जीएसटी नोंदणी आहे का?',
  'GST number': 'GST number / जीएसटी क्रमांक'
};
food.fields = food.fields.map(item => ({ ...item, required: true, displayLabel: foodFieldHeadings[item.label] }));
food.documents = [
  ...shopAct.documents.filter(item => ['Owner Aadhaar Card', 'Owner Photo', 'Owner Signature Image', 'Owner PAN Card', 'Shop Board Photo', 'Firm PAN Card'].includes(item.label)).map(item => ({ ...item,
    // Preserve the identifiers already used by Food Licence uploads.
    ...(item.label === 'Owner Aadhaar Card' ? { label: 'Aadhaar Card', displayLabel: 'Owner / All Partners - Aadhaar Card / मालकाचे / सर्व भागीदारांचे आधार कार्ड' } : {}),
    ...(item.label === 'Owner PAN Card' ? { label: 'PAN Card', displayLabel: 'Owner / All Partners - PAN Card / मालकाचे / सर्व भागीदारांचे पॅन कार्ड' } : {}),
    ...(item.label === 'Owner Signature Image' ? { displayLabel: 'Owner / All Partners - Signature / मालकाची / सर्व भागीदारांची सही' } : {}),
    ...(item.label === 'Shop Board Photo' ? { displayLabel: 'Shop Board Photo / दुकानाच्या फलकाचा फोटो' } : {}),
    ...(item.label === 'Firm PAN Card' ? { displayLabel: 'Firm PAN Card / भागीदारी फर्मचे पॅन कार्ड' } : {})
  })),
  { ...doc('Partnership Deed', 'Required for a partnership. / भागीदारी व्यवसाय असल्यास आवश्यक.', { field: 'Ownership type', equals: 'Partnership' }), displayLabel: 'Partnership Deed / भागीदारी करारपत्र' },
  { ...doc('Electricity Bill'), displayLabel: 'Electricity Bill / वीज बिल' },
  { ...doc('Rent Agreement', 'Required for rented premises. / दुकान भाड्याने असल्यास आवश्यक.', { field: 'Owned or rented', equals: 'Rented' }), displayLabel: 'Rent Agreement / भाडे करारपत्र' },
  { ...doc('Property Tax Record'), displayLabel: 'Property Tax Receipt / प्रॉपर्टी टॅक्स पावती' },
  { ...doc('Business Photos (inside and outside)', 'Upload clear photos of both the inside and outside of the shop. / दुकानाच्या आतील व बाहेरील भागांचे स्पष्ट फोटो अपलोड करा.'), displayLabel: 'Business Photos (inside and outside) / दुकानाचे आतील व बाहेरील फोटो', multiple: true }
];

// Model conditional proofs as separate checklist items so each can be validated.
for (const slug of ['caste-certificate','non-creamy-layer']) {
  serviceCatalog.find(service => service.slug === slug).documents.push(doc('Father Aadhaar Card', 'Required for applicants under 18.', { field:'Applicant under 18?', equals:'Yes' }));
}

// Keep stored document labels stable for existing uploads; translate the checklist presentation.
const marathiDocuments = {
  'Partnership Deed': 'भागीदारी करारपत्र',
  'Old Passport': 'जुना पासपोर्ट',
  'Name Change / Correction Proof': 'नाव बदलाचा किंवा दुरुस्तीचा पुरावा',
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
    'तीन वर्षांचे उत्पन्न प्रमाणपत्र अनिवार्य आहे. सर्व पाने अपलोड करा. / The income certificate covering three years is mandatory. Upload all pages.',
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
    'जात वैधता माहिती फॉर्म डाउनलोड करून प्रिंट काढा, हाताने भरा आणि भरलेला फॉर्म कागदपत्रे विभागात अपलोड करा. / Download and print the Caste Validity Information Form, fill it in by hand and upload the completed form in the Documents section.',
    'घरातील कोणाची जात पडताळणी झाली असल्यास त्यांचे जात वैधता प्रमाणपत्र अपलोड करा. / Upload a family member caste validity certificate if available.'
  ],
  'ews-certificate': [
    'दिलेल्या संदर्भ फॉर्मनुसार प्रमाणपत्राचा कालावधी १ एप्रिल २०२६ ते ३१ मार्च २०२७ आहे. / The supplied reference form lists the certificate period as 1 April 2026 to 31 March 2027.',
    'आजोबा किंवा पणजोबांचा शाळा सोडल्याचा दाखला तसेच जुना आकारणी उतारा, ७/१२ उतारा किंवा मालमत्ता पत्रक अपलोड करा. / Upload the grandfather or great-grandfather school leaving certificate and an old assessment extract, 7/12 extract or property card.',
    'ॲसेसमेंट उताऱ्यात दिलेले क्षेत्रफळ एक हजार स्क्वेअर फुटांच्या (१००० चौ. फूट) आत असले पाहिजे. / The area stated in the assessment extract must be less than 1,000 square feet.',
    'इतर सहाय्यक कागदपत्रे उपलब्ध असल्यास इतर कागदपत्रे या ऐच्छिक पर्यायातून अपलोड करा. / If available, upload additional supporting documents using the optional Other Document upload.'
  ],
  'food-license': ['शॉपचे नाव, ईमेल, संपूर्ण पत्ता, दुकान स्वतःचे की भाड्याने, व्यवसायाचे स्वरूप, मोबाईल नंबर व गुंतवणूक भरा. GST नंबर असल्यास होय निवडून नंबर भरा. / Enter the shop name, email, full address, owned or rented status, business activity, mobile number and investment. If GST registered, select Yes and enter the GST number.', 'मालकाचे व भागीदारी असल्यास प्रत्येक भागीदाराचे आधार कार्ड, फोटो, सही व पॅन कार्ड अपलोड करा. भागीदारी करारपत्र व फर्मचे पॅन कार्ड भागीदारी असल्यास आवश्यक आहे. / Upload Aadhaar, photo, signature and PAN for the owner and every partner. Partnerships also require the partnership deed and firm PAN.', 'दुकानाच्या फलकाचा फोटो, प्रॉपर्टी टॅक्स पावती, वीज बिल व दुकानाच्या आतील व बाहेरील भागांचे फोटो अपलोड करा. दुकान भाड्याने असल्यास भाडे करारपत्र आवश्यक आहे. / Upload the shop board photo, property tax receipt, electricity bill and inside/outside shop photos. A rent agreement is required for rented premises.'],
  'passport': [
    'पॅन कार्ड आणि आधार कार्डाच्या स्पष्ट व संपूर्ण प्रती अपलोड करा. / Upload clear and complete copies of the PAN Card and Aadhaar Card.',
    'मोबाईल नंबर, ईमेल आयडी, जन्मस्थान, पोलीस ठाणे आणि आपत्कालीन संपर्क क्रमांक भरा. / Enter the mobile number, email ID, birth place, police station and emergency number.',
    'आईचे नाव, वडिलांचे नाव आणि शिक्षण भरा. पत्नीचे नाव ऐच्छिक आहे; लागू नसल्यास रिकामे ठेवा. / Enter the mother name, father name and education. Wife name is optional; leave it blank if not applicable.',
    'व्यवसाय निवडा: नोकरदार, शासकीय कर्मचारी, स्वयंरोजगार, विद्यार्थी किंवा किरकोळ विक्रेता. / Select the occupation: Employee, Government Employee, Self-employed, Student or Retailer.',
    'नवीन पासपोर्ट की नूतनीकरण आणि अर्जदार १८ वर्षांखालील आहे का ते निवडा. नूतनीकरणासाठी जुना पासपोर्ट अपलोड करा. / Select New or Renew and whether the applicant is under 18. For renewal, upload the old passport.',
    'नावातील स्पेलिंग दुरुस्ती किंवा लग्नानंतर नाव बदलायचे असल्यास होय निवडून जुने नाव भरा. नवीन किंवा दुरुस्त नावाचा पुरावा, उदा. राजपत्र (गॅझेट) किंवा अद्ययावत आधार कार्ड, अपलोड करा. / For a name spelling correction or name change after marriage, select Yes and enter the old name. Upload proof of the new or corrected name, such as a Gazette notification or updated Aadhaar card.'
  ],
  'voting-card': ['नवीन मतदार ओळखपत्र किंवा दुरुस्ती यापैकी पर्याय निवडा. दुरुस्ती असल्यास चुकीची माहिती निवडा व तिच्याऐवजी योग्य माहिती भरा. / Choose New or Correction. For a correction, select the incorrect detail and enter the correct information.', 'अर्जदाराचे आधार कार्ड व स्पष्ट फोटो अपलोड करा. दुरुस्तीसाठी जुने मतदार ओळखपत्रही अपलोड करा. छायाचित्र दुरुस्तीसाठी नवीन छायाचित्र अपलोड करा. / Upload the applicant Aadhaar card and a clear photograph. Corrections also require the old voting card. For a photograph correction, upload the new photograph.'],
  'pan': ['जन्म दाखला, वाहनचालक परवाना किंवा मतदार ओळखपत्र यापैकी जन्मतारीख नमूद असलेला कोणताही एक पुरावा अपलोड करा. / Upload any one date-of-birth proof: birth certificate, driving licence or voter ID showing the date of birth.'],
  'pf-assistance': ['यूएएन क्रमांक, पासवर्ड आणि आवश्यक पीएफ कामाची माहिती भरा. प्रोफाइल अद्ययावत करायचे असल्यास होय निवडा व ईमेल पत्ता भरा. / Enter the UAN number, password and the PF work required. If you want to update your PF profile, select Yes and enter the email address.', 'आधार कार्ड, पॅन कार्ड, आत्ताचा फोटो व बँक पासबुक अनिवार्य आहेत. इतर कागदपत्रे ऐच्छिक आहेत. / Aadhaar card, PAN card, live photo and bank passbook are compulsory. Other documents are optional.'],
  'ration-card': [
    'पुढे जाण्यासाठी किमान एका प्रश्नाचे उत्तर द्या. लागू नसलेले प्रश्न रिकामे ठेवू शकता. एकाच अर्जात एकापेक्षा जास्त बदल निवडता येतात. / Answer at least one question to continue. Questions that do not apply may be left unanswered. You can select multiple changes in one application.',
    'सध्याचे रेशन कार्ड, सर्व सदस्यांची आधार कार्डे, पॅन कार्डे, फोटो, लाईट बिल, गॅस पासबुक, रेशन दुकान अ.ब.क. दाखला व रेशन कार्ड प्रमुख महिलेचे बँक पासबुक अनिवार्य आहेत. / The existing ration card, Aadhaar cards, PAN cards and photos for every member, electricity bill, gas passbook, ration shop A.B.C. certificate and the female head’s bank passbook are compulsory.',
    'भाड्याने राहत असल्यास संमती पत्र किंवा भाडेकरार आवश्यक आहे. पांढऱ्या रेशन कार्डसाठी ITR, फॉर्म १६ किंवा पेन्शन स्टेटमेंट यापैकी एक पुरावा आवश्यक आहे. / A rented home requires a consent letter or rent agreement. A white ration card requires any one of ITR, Form 16 or pension statement.',
    'पत्ता बदलासाठी नवीन पत्त्याचे लाईट बिल किंवा घरफळा पावती यापैकी एक पुरावा अपलोड करा. हा पुरावा एकदाच अपलोड करणे पुरेसे आहे. / For an address change, upload either the new address electricity bill or property tax receipt. Uploading this proof once is sufficient.'
  ]
};
for (const slug of ['shop-act', 'udyam-aadhaar']) {
  serviceNotes[slug].push('दुकान स्वतःचे असल्यास वीज बिल, भाड्याने असल्यास भाडे करारपत्र अपलोड करा. भागीदारी असल्यास भागीदारी करारपत्र आवश्यक आहे. / Upload the Light Bill for owned premises or the Rent Agreement for rented premises. Partnerships also require the Partnership Deed.');
}
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
  if (['shop-act', 'udyam-aadhaar', 'food-license'].includes(service.slug)) {
    for (const document of service.documents.filter(document => document.multiple)) {
      document.displayLabel = (document.displayLabel || document.label).replace(/^Owner /, 'Owner / All Partners - ');
      if (document.label === 'Owner Photo') document.note += ' Upload a live photo of EVERY partner. / प्रत्येक भागीदाराचा आत्ताचा फोटो अपलोड करा.';
    }
  }
  if (serviceNotes[service.slug]) service.instructions = serviceNotes[service.slug].join('\n');
}
