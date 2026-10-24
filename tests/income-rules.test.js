import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
import '../public/intake-rules.js';
const income = serviceCatalog.find(s=>s.slug==='income-certificate');
const {matches, available, willing, withSurcharge} = IntakeRules;
const base = {'Years of Certificate Required':'1 year','Ration card colour':'Yellow','Ration card area':'City',[available]:'No',[willing]:'No'};
const documents = details => income.documents.filter(doc=>matches(doc.when,details)).map(doc=>doc.label);

test('income proof is required strictly above one lakh, for any active year',()=>{
  for (const amount of ['99999','100000','100000.01','150000']) {
    assert.equal(documents({...base,'Income amount required on certificate (₹)':amount}).includes('Salary/Pay Slip / ITR / Form 16'),Number(amount)>100000);
  }
  const years = income.fields.filter(f=>f.when?.equals==='3 years');
  for (const year of years) assert.ok(documents({...base,'Years of Certificate Required':'3 years',[year.label]:'100001'}).includes('Salary/Pay Slip / ITR / Form 16'));
  assert.ok(!documents({...base,'Years of Certificate Required':'3 years','Income amount required on certificate (₹)':'150000'}).includes('Salary/Pay Slip / ITR / Form 16'));
  const white = documents({...base,'Ration card colour':'White','Income amount required on certificate (₹)':'150000'});
  assert.ok(white.includes('Form 16 / ITR'));
  assert.ok(!white.includes('Salary/Pay Slip / ITR / Form 16'));
});

test('Talathi questions, documents and surcharge cover every city and village path',()=>{
  for (const [area,has,bring,report,extra] of [['City','Yes',undefined,true,0],['City','No','Yes',true,0],['City','No','No',false,20000],['Village',undefined,undefined,true,0]]) {
    const details = {...base,'Ration card area':area,[available]:has,[willing]:bring};
    assert.equal(documents(details).includes('Talathi Report'),report);
    const amount = withSurcharge({serviceCharge:20000,officialFee:0,tax:0,total:20000},details);
    assert.equal(amount.total,20000+extra);
    assert.equal(matches(income.fields.find(f=>f.label===available).when,details),area==='City');
    assert.equal(matches(income.fields.find(f=>f.label===willing).when,details),area==='City'&&has==='No');
  }
});

test('hospital document has Marathi and Hindi labels and is conditional',()=>{
  assert.ok(documents({...base,'Reason for application':'Hospital'}).includes('Hospital Letter / Medical Certificate'));
  assert.ok(!documents({...base,'Reason for application':'Banking'}).includes('Hospital Letter / Medical Certificate'));
  assert.match(income.documents.find(d=>d.label==='Hospital Letter / Medical Certificate').displayLabel,/वैद्यकीय दाखला.*चिकित्सा प्रमाण पत्र/);
  assert.ok(income.documents.every(d=>d.marathiLabel && !d.marathiLabel.includes('?')));
});

test('address proof No adds the affidavit fee and Yes removes it',()=>{
  const amount={serviceCharge:20000,officialFee:0,tax:0,total:20000};
  for(const [answer,extra] of [['Yes',0],['No',20000],[undefined,0]]) {
    const result=withSurcharge(amount,{[IntakeRules.addressProof]:answer});
    assert.equal(result.surcharge,extra);
    assert.equal(result.serviceCharge,20000+extra);
    assert.equal(result.total,20000+extra);
  }
  assert.equal(amount.total,20000,'Calculating the surcharge does not change the base price');
});
