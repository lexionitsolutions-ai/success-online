import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sheetHeaders,operationsRows} from '../operations-schema.js';

const customerCase={ref:'SO-2026-000001',created_at:'2026-11-01T20:00:00Z',updated_at:'2026-11-02T08:00:00Z',customer:{name:'Test Client',mobile:'0987654321'},service:{name:'EWS Certificate'},sales:{name:'Sales One'},backoffice:{name:'Work Person'},document_state:'complete',status:'Assigned',amounts:{total:20000},payment:{status:'PENDING'}};
const receipt={id:'pay-one',gateway:'direct_upi',amount:15000,status:'PAID',payment_method:'QR',created_at:'2026-11-01T20:00:00Z',verified_at:'2026-11-02T06:00:00Z'};

test('two-tab operations mirror records paid amount, balance, assignment, and India date',()=>{
  assert.deepEqual(Object.keys(sheetHeaders),['All Workings','Cash Flow']);
  const rows=operationsRows(customerCase,[receipt,{...receipt,id:'pending',status:'PENDING'},{...receipt,id:'demo',gateway:'demo'}]);
  assert.equal(rows.working.length,sheetHeaders['All Workings'].length);
  assert.deepEqual(rows.working.slice(0,8),['SO-2026-000001','2026-11-02','Test Client','0987654321','EWS Certificate','Sales One','complete','Work Person']);
  assert.deepEqual(rows.working.slice(8,14),[200,150,50,'QR','PARTIALLY PAID','Assigned']);
  assert.equal(rows.cash.length,1);
  assert.equal(rows.cash[0][0],'pay-one');
  assert.deepEqual(rows.cash[0][1],['2026-11-02','EWS Certificate - Test Client',150,'QR','SO-2026-000001','Test Client','EWS Certificate','pay-one','PAID']);
});

test('unverified claims are not cash receipts; refunds retain receipt and separate negative entry',()=>{
  const unpaid=operationsRows(customerCase,[{...receipt,status:'AWAITING_VERIFICATION'}]);
  assert.equal(unpaid.cash.length,0);assert.equal(unpaid.working[9],0);assert.equal(unpaid.working[10],200);
  const refunded=operationsRows(customerCase,[{...receipt,status:'REFUNDED'}],[{payment_id:'pay-one',created_at:'2026-11-03T08:00:00Z'}]);
  assert.equal(refunded.working[9],0);assert.equal(refunded.working[12],'REFUNDED');
  assert.equal(refunded.cash.length,2);assert.equal(refunded.cash[1][0],'pay-one:refund');
  assert.equal(refunded.cash[1][1][0],'2026-11-03');assert.equal(refunded.cash[1][1][2],-150);
  assert.equal(refunded.cash.reduce((sum,[,row])=>sum+row[2],0),0);
  assert.deepEqual(operationsRows(customerCase,[receipt]),operationsRows(customerCase,[receipt]),'Stable keys allow retry upserts');
});

test('exported client text cannot introduce spreadsheet formulas',()=>{
  const rows=operationsRows({...customerCase,customer:{name:'=IMPORTXML("bad")',mobile:'0987654321'},sales:{name:'+formula'}},[receipt]);
  assert.ok(rows.working[2].startsWith("'="));assert.ok(rows.working[5].startsWith("'+"));
  assert.ok(rows.cash[0][1][5].startsWith("'="));
});

test('paste-ready Apps Script creates exactly two tabs, preserves rows on rerun, and rejects incompatible headers',()=>{
  const script=readFileSync('google-apps-script/script.js','utf8');
  assert.equal(script,readFileSync('google-apps-script/Code.gs','utf8'));
  const sheets=new Map(),formats=[],created=[];
  let released=0;
  const ss={getSheetByName:name=>sheets.get(name),setSpreadsheetTimeZone:zone=>assert.equal(zone,'Asia/Kolkata'),toast(){},insertSheet(name){
    created.push(name);
    const sheet={headers:[],data:[],getMaxColumns:()=>26,getMaxRows:()=>1000,getLastRow:()=>sheet.data.length+1,getFilter:()=>null};
    for(const name of ['setRowHeight','setFrozenRows','setFrozenColumns','setColumnWidths','setColumnWidth'])sheet[name]=()=>sheet;
    sheet.getRange=(row,col,count,width)=>{
      const range={setValues(values){assert.equal(row,1,'Setup never overwrites data rows');sheet.headers=[...values[0]];return range;},getValues:()=>[sheet.headers.slice(0,width)],setNumberFormat(format){formats.push(format);return range;}};
      for(const name of ['setFontWeight','setBackground','setFontColor','setWrap','setVerticalAlignment','setFontFamily','setFontSize','createFilter'])range[name]=()=>range;
      return range;
    };
    sheets.set(name,sheet);return sheet;
  }};
  const context=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){}},LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){released++;}})}});
  vm.runInContext(script,context);vm.runInContext('setupSuccessOnlineWorkbook()',context);
  sheets.get('All Workings').data.push(['existing application']);
  vm.runInContext('setupSuccessOnlineWorkbook()',context);
  assert.deepEqual(created,['All Workings','Cash Flow']);
  assert.deepEqual(sheets.get('All Workings').data,[['existing application']]);
  assert.ok(formats.includes('@'));assert.equal(released,2);
  sheets.get('All Workings').headers=['wrong'];
  assert.throws(()=>vm.runInContext('setupSuccessOnlineWorkbook()',context),/different table/);
  assert.equal(released,3);
});
