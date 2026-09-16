#!/usr/bin/env node
'use strict';
const fs = require('fs');
const gate = fs.readFileSync('js/tongan-demo-gate.js', 'utf8');
const page = fs.readFileSync('tongan-research-database-master.html', 'utf8');
function ok(value, message) { if (!value) throw new Error(message); }
ok(gate.includes("COLLABORATOR_PASSCODE = atob('VDBuZ2FuMjAyNg==')"), 'collaborator password missing');
ok(gate.includes('data-collaborator-form'), 'password form missing');
ok(gate.includes("sessionStorage.setItem(COLLAB_FLAG_KEY, '1')"), 'session unlock missing');
ok(gate.includes("mode = 'collaborator'"), 'collaborator boot path missing');
ok(page.includes('tongan-demo-gate.js?v=collabpass20260908'), 'cache version missing');
new Function(gate);
console.log('Tongan collaborator password gate: PASS');
