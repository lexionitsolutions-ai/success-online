import test from 'node:test';
import assert from 'node:assert/strict';
import { reuploadState } from '../reuploads.js';

const stamp='2026-10-21T08:00:00.000Z';
const document=(id,type='Photo')=>({id,doc_type:type,state:'uploaded',created_at:stamp,version:1});
const request=(id,types,baseline)=>({id,new_status:'Correction Required',created_at:stamp,next_action:JSON.stringify({type:'reupload_request',documentTypes:types,baselineDocumentIds:baseline})});

test('a reupload request needs a new file ID even when upload timestamps are equal',()=>{
  const item={status:'Correction Required',document_state:'complete'};
  const notes=[request('r1',['Photo'],['old'])];
  assert.equal(reuploadState(item,[document('old')],notes).canSubmit,false);
  const updated=reuploadState(item,[{...document('old'),state:'replaced'},document('new')],notes);
  assert.equal(updated.canSubmit,true);
  assert.deepEqual(updated.pendingDocumentIds,['new']);
});

test('all requested document types need replacements, including added report pages',()=>{
  const state=reuploadState({status:'Correction Required',document_state:'complete'},[document('photo'),document('old-report','Report'),document('page','Report')],[request('r1',['Photo','Report'],['photo','old-report'])]);
  assert.deepEqual(state.pendingDocumentIds,['page']);
  assert.deepEqual(state.missingTypes,['Photo']);
  assert.equal(state.canSubmit,false);
});

test('submitted file highlights persist and a later correction starts a fresh cycle',()=>{
  const docs=[document('new')];
  const notes=[request('r1',['Photo'],['old']),{id:'s1',new_status:'Document Review',created_at:stamp,next_action:JSON.stringify({type:'reupload_submission',requestIds:['r1'],documentIds:['new']})}];
  const submitted=reuploadState({status:'Document Review',document_state:'complete'},docs,notes);
  assert.equal(submitted.pending,false);
  assert.deepEqual(submitted.submittedDocumentIds,['new']);
  const again=reuploadState({status:'Correction Required',document_state:'complete'},docs,[...notes,request('r2',['Photo'],['new'])]);
  assert.equal(again.canSubmit,false);
  assert.deepEqual(again.requestIds,['r2']);
});

test('legacy correction instructions work and malformed metadata does not break case details',()=>{
  const notes=[{id:'r1',new_status:'Correction Required',created_at:stamp,next_action:'null'}];
  const state=reuploadState({status:'Correction Required',document_state:'complete'},[document('new')],notes);
  assert.equal(state.canSubmit,true);
  assert.deepEqual(state.pendingDocumentIds,['new']);
});

test('moving a correction to Awaiting Documents does not discard an already reuploaded file',()=>{
  const notes=[request('r1',['Photo'],['old']),{id:'n2',old_status:'Correction Required',new_status:'Awaiting Documents',created_at:'2026-10-21T08:01:00.000Z',next_action:''}];
  const state=reuploadState({status:'Awaiting Documents',document_state:'complete'},[document('new')],notes);
  assert.equal(state.canSubmit,true);
  assert.deepEqual(state.requestIds,['r1']);
});
