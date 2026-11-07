import { stepOptions, validateStep, visibleSteps } from '../questions.js';
import { renderTopbar, toast, escapeHtml } from '../ui.js';
import { addResponse, setProfile } from '../store.js';
import { pushResponse } from '../cloud.js';

renderTopbar('survey');

const draft = {};
const history = []; // { field, question, answerLabel }
let index = 0;
let multiSelection = [];
let locked = false;

const el = {
  transcript: document.querySelector('#transcript'),
  progressFill: document.querySelector('#progress-fill'),
  progressText: document.querySelector('#progress-text'),
  eyebrow: document.querySelector('#step-eyebrow'),
  question: document.querySelector('#question-text'),
  why: document.querySelector('#question-why'),
  options: document.querySelector('#options'),
  back: document.querySelector('#btn-back'),
  next: document.querySelector('#btn-next'),
  hint: document.querySelector('#keyboard-hint'),
};

function currentStep() {
  return visibleSteps(draft)[index];
}

function renderTranscript() {
  el.transcript.innerHTML = history
    .slice(-3)
    .map(
      (item) => `
      <div class="bubble bubble-bot" style="max-width:100%;padding:.6rem .9rem">
        <span class="small muted">${escapeHtml(item.question)}</span>
      </div>
      <div class="bubble bubble-user">${escapeHtml(item.answerLabel)}</div>`,
    )
    .join('');
}

function render() {
  const steps = visibleSteps(draft);
  if (index >= steps.length) {
    finish();
    return;
  }
  const step = steps[index];
  const options = stepOptions(step, draft);

  el.progressFill.style.width = `${Math.round(((index + 1) / steps.length) * 100)}%`;
  el.progressText.textContent = `${index + 1} / ${steps.length}`;
  el.eyebrow.textContent = step.eyebrow || '';
  el.question.textContent = step.title;
  el.why.textContent = step.why || '';
  el.back.disabled = index === 0;

  el.options.className = `options${step.multi || options.length >= 7 ? ' is-wide' : ''}`;
  el.options.innerHTML = options
    .map(
      (option, optionIndex) => `
      <button type="button" class="option" data-value="${escapeHtml(option.value)}" aria-pressed="false">
        <span class="opt-key">${step.multi ? '多选' : String(optionIndex + 1)}</span>
        <span class="opt-label">${escapeHtml(option.label)}</span>
        ${option.hint ? `<span class="opt-hint">${escapeHtml(option.hint)}</span>` : ''}
      </button>`,
    )
    .join('');

  multiSelection = [];
  el.next.hidden = !step.multi;
  el.next.disabled = true;
  el.hint.innerHTML = step.multi
    ? `最多选 <b>${step.max || options.length}</b> 项，选好后点「下一步」`
    : `按 <span class="kbd">1</span>–<span class="kbd">${Math.min(9, options.length)}</span> 快速选择`;

  renderTranscript();
  document.querySelector('.survey-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function answerLabelOf(step, value) {
  const options = stepOptions(step, draft);
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => options.find((option) => option.value === item)?.label || item)
    .join(' / ');
}

function commit(step, value) {
  const error = validateStep(step, value, draft);
  if (error) {
    toast(error, 'error');
    return;
  }
  draft[step.field] = value;
  history.push({ field: step.field, question: step.title, answerLabel: answerLabelOf(step, value) });
  index += 1;
  render();
}

function finish() {
  if (locked) return;
  locked = true;
  const profile = { ...draft };
  setProfile(profile);
  const record = addResponse(profile, { source: 'web', completed: true });
  pushResponse(record).catch(() => {});
  el.progressFill.style.width = '100%';
  el.progressText.textContent = '完成';
  el.question.textContent = '画像生成完毕';
  el.why.textContent = '正在为你匹配活动…';
  el.options.innerHTML = '';
  el.back.hidden = true;
  el.next.hidden = true;
  el.hint.textContent = '';
  setTimeout(() => {
    window.location.href = 'recommend.html?fresh=1';
  }, 700);
}

/* ------------------------------------------------------------------ 交互 */

el.options.addEventListener('click', (event) => {
  const button = event.target.closest('.option');
  if (!button) return;
  const step = currentStep();
  const value = button.dataset.value;

  if (!step.multi) {
    button.setAttribute('aria-pressed', 'true');
    setTimeout(() => commit(step, value), 160);
    return;
  }

  const position = multiSelection.indexOf(value);
  if (position >= 0) {
    multiSelection.splice(position, 1);
    button.setAttribute('aria-pressed', 'false');
  } else {
    if (multiSelection.length >= (step.max || 99)) {
      toast(`最多选 ${step.max} 项`, 'error');
      return;
    }
    multiSelection.push(value);
    button.setAttribute('aria-pressed', 'true');
  }
  el.next.disabled = multiSelection.length === 0;
});

el.next.addEventListener('click', () => {
  const step = currentStep();
  if (!step || !step.multi) return;
  commit(step, [...multiSelection]);
});

el.back.addEventListener('click', () => {
  if (index === 0) return;
  index -= 1;
  const last = history.pop();
  if (last) delete draft[last.field];
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const step = currentStep();
  if (!step) return;
  const options = stepOptions(step, draft);

  if (event.key === 'Enter' && step.multi) {
    if (multiSelection.length) commit(step, [...multiSelection]);
    return;
  }
  const numeric = Number(event.key);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
    event.preventDefault();
    const value = options[numeric - 1].value;
    if (step.multi) {
      const button = el.options.querySelector(`[data-value="${CSS.escape(value)}"]`);
      button?.click();
    } else {
      const button = el.options.querySelector(`[data-value="${CSS.escape(value)}"]`);
      button?.click();
    }
  }
  if (event.key === 'Backspace' && index > 0) {
    event.preventDefault();
    el.back.click();
  }
});

// 如果 URL 带 ?reset=1，清空草稿重新开始（默认就是从零开始，这里只是显式化）
if (new URLSearchParams(window.location.search).get('reset') === '1') {
  for (const key of Object.keys(draft)) delete draft[key];
  history.length = 0;
  index = 0;
}

render();
