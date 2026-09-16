#!/usr/bin/env node
'use strict';
const fs = require('fs');
const html = fs.readFileSync('tongan-research-database-master.html', 'utf8');
function ok(value, message) { if (!value) throw new Error(message); }
ok(!html.includes('Prof. Ron Vave'), 'old abbreviated title remains');
ok(!html.includes('>Professor Ron Vave<'), 'old full title remains');
ok(html.includes('Assistant Professor Ron Vave'), 'Assistant Professor title missing');
ok(!html.includes('Assistant Assistant Professor'), 'duplicated Assistant title');
ok(html.includes('href="https://about.byuh.edu/directory/tevita-kaili"'), 'Tevita Kaili profile link missing');
ok(html.includes('>Professor Tevita Kaili</a>'), 'Tevita Kaili collaborator credit missing');
ok(html.includes('href="https://about.byuh.edu/directory/inoke-hafoka"'), 'Inoke Hafoka profile link missing');
ok(html.includes('>Associate Professor Inoke Hafoka</a>'), 'Inoke Hafoka collaborator credit missing');
ok(html.includes('Brigham Young University–Hawaii'), 'collaborator institution missing');
console.log('Tongan dashboard attribution: PASS');
