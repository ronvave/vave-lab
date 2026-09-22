/* Completed graduate disciplines, using the same Master snapshot as other panels. */
(function () {
  'use strict';
  const root = document.getElementById('graduate-disciplines');
  if (!root) return;
  let model = null, view = 'gender';
  const table = root.querySelector('table');
  const status = root.querySelector('[data-disciplines-status]');
  const caption = root.querySelector('.short-disciplines-caption');
  const number = n => Number(n).toLocaleString('en-US');
  function row(parent, values, heading) {
    const tr = document.createElement('tr');
    values.forEach((value, i) => {
      const cell = document.createElement(heading || i === 0 ? 'th' : 'td');
      if (cell.tagName === 'TH') cell.scope = heading ? 'col' : 'row';
      cell.textContent = value; tr.appendChild(cell);
    });
    parent.appendChild(tr);
  }
  function render() {
    if (!model) return;
    const gender = view === 'gender';
    const keys = gender ? ['male','female','total'] : ['masters','phd','total'];
    table.querySelector('caption').textContent = 'Graduate degree short disciplines — unique iTaukei scholars with completed degrees' + (gender ? ' by gender' : '');
    ['thead','tbody','tfoot'].forEach(tag => table.querySelector(tag).replaceChildren());
    row(table.tHead, ['Short Discipline', ...(gender ? ['Male','Female'] : ['Completed Master’s','Completed PhD']), 'Total'], true);
    model.rows.forEach(item => row(table.tBodies[0], [item.discipline, ...keys.map(k => number(item[k]))]));
    row(table.tFoot, ['Unique scholars overall', ...keys.map(k => number(model.overall[k]))]);
    const intro = 'Interpretation: This table uses the Short Discipline column in Graduate Degrees and counts unique iTaukei Scholar IDs with completed degrees, not degree records. Only records whose completion status begins with Completed are included; degrees currently in progress, non-completed, or uncertain about completion are excluded. ';
    caption.textContent = intro + (gender
      ? `Blank Short Discipline entries are also excluded, so this table currently includes ${number(model.overall.total)} of the ${number(model.allCompleted)} unique scholars with either a completed Master's or completed PhD. A scholar with completed degrees in more than one short discipline is counted once in each relevant discipline; the final row counts each scholar once overall.`
      : `Blank Short Discipline entries are also excluded, which is why this table currently includes ${number(model.overall.masters)} of the ${number(model.allMasters)} completed Master's scholars. The Completed Master's and Completed PhD columns count each scholar once within that stage. Total counts each scholar once per short discipline, even when the scholar completed both stages; totals across disciplines should not be summed.`);
    if (gender && model.overall.total > model.overall.male + model.overall.female) caption.textContent += ' Scholars without a recorded Male or Female value remain included in Total.';
    table.hidden = !model.rows.length;
    status.textContent = model.rows.length ? '' : 'No completed degrees with a Short Discipline are available.';
    root.querySelector('[data-disciplines-updated]').textContent = 'Data updated: ' + new Date(model.generatedAt).toLocaleString() + '. Master snapshots refresh every two hours; reload to retrieve the latest snapshot.';
  }
  root.querySelectorAll('[data-discipline-view]').forEach(button => button.addEventListener('click', () => {
    view = button.dataset.disciplineView;
    root.querySelectorAll('[data-discipline-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    render();
  }));
  function hydrate(master) {
    const next = master && master.aggregates && master.aggregates.shortDisciplines;
    if (!next || !Array.isArray(next.rows) || !next.overall) {
      status.textContent = model ? 'The latest discipline summary is unavailable. Showing the last loaded data.' : 'The discipline summary is unavailable. Please reload after the next Master data refresh.';
      return;
    }
    model = next; render();
  }
  setTimeout(() => {
    if (!model && !window.__masterHydrated) status.textContent = 'Graduate research data has not loaded. Check your connection or unlock the dashboard, then reload.';
  }, 30000);
  window.addEventListener('vavelab:master-hydrated', e => hydrate(e.detail.master));
  if (window.__masterHydrated) hydrate(window.__vavelabDbState.master);
})();
