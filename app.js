/* ============================================================
   FitLife — основная логика
   Версия: 4.1 (исправлены кнопки Ещё и Другой вариант)
   Файл: app.js
   ============================================================ */

import {
  registerUser, loginUser, loginWithGoogle, logoutUser,
  onAuthChange, getCurrentUser, checkRedirectResult,
  saveProfileToCloud, loadProfileFromCloud,
  saveMeasurementToCloud, loadMeasurementsFromCloud, deleteMeasurementFromCloud,
  saveCustomMealToCloud, loadCustomMealsFromCloud, deleteCustomMealFromCloud,
  saveWorkoutLogToCloud, loadWorkoutLogFromCloud,
  syncAllFromCloud
} from "./firebase.js";

/* ============================================================
   1. СОСТОЯНИЕ
   ============================================================ */
let state = {
  user: null,
  fbUser: null,
  norm: null,
  measurements: [],
  customMeals: [],
  workoutLog: {},
  workoutPlan: null,
  currentMealPlan: null,
  theme: "dark",
  planSeed: 0,
  recipeFilter: "all",
  exerciseFilter: "all",
  searchCat: "all",
  currentMealItems: [],
  level: "novice"
};

function saveLocal() {
  try {
    localStorage.setItem("fitlife_state", JSON.stringify({
      user: state.user,
      measurements: state.measurements,
      customMeals: state.customMeals,
      workoutLog: state.workoutLog,
      workoutPlan: state.workoutPlan,
      theme: state.theme,
      planSeed: state.planSeed,
      level: state.level
    }));
  } catch (e) { console.warn("saveLocal error:", e); }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem("fitlife_state");
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch (e) { console.warn("loadLocal error:", e); }
}

/* ============================================================
   2. ВСПОМОГАТЕЛЬНОЕ
   ============================================================ */
function toast(msg, type = "") {
  const e = document.getElementById("toast");
  if (!e) return;
  e.textContent = msg;
  e.className = "toast show " + type;
  setTimeout(() => { e.className = "toast " + type; }, 2800);
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const s = document.getElementById("screen-" + name);
  if (s) s.classList.add("active");
  document.querySelectorAll(".nav button").forEach(b =>
    b.classList.toggle("active", b.dataset.screen === name)
  );
  if (name === "dashboard") renderDashboard();
  if (name === "nutrition") window.generateMealPlan();
  if (name === "my-plan") renderMyPlan();
  if (name === "measure") renderMeasurements();
  if (name === "profile") renderProfile();
  if (name === "search") initSearch();
  if (name === "recipes") renderRecipeList();
  if (name === "exercises") renderExerciseList();
  if (name === "meal-builder") renderMealBuilder();
  if (name === "my-meals") renderMyMeals();
  window.closeMoreMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const dur = 800;
  const st = performance.now();
  function tick(now) {
    const pr = Math.min((now - st) / dur, 1);
    const e = 1 - Math.pow(1 - pr, 3);
    el.textContent = Math.round(target * e);
    if (pr < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* Меню «Ещё» — привязано к window, работает всегда */
window.openMoreMenu = function () {
  const menu = document.getElementById("more-menu");
  const overlay = document.getElementById("more-overlay");
  if (menu) menu.classList.add("show");
  if (overlay) overlay.classList.add("show");
};

window.closeMoreMenu = function () {
  const menu = document.getElementById("more-menu");
  const overlay = document.getElementById("more-overlay");
  if (menu) menu.classList.remove("show");
  if (overlay) overlay.classList.remove("show");
};

/* ============================================================
   3. РАСЧЁТ НОРМЫ
   ============================================================ */
function calcNorm(user) {
  const { sex, age, height, weight, goal, activity } = user;
  let bmr;
  if (sex === "m") bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  else bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  let tdee = bmr * activity;
  let cal;
  if (goal === "lose") { const d = age < 18 ? 0.12 : 0.18; cal = tdee * (1 - d); }
  else if (goal === "gain") cal = tdee * 1.12;
  else cal = tdee;
  const minCal = sex === "m" ? 1500 : 1200;
  if (cal < minCal) cal = minCal;
  const protein = Math.round(weight * (goal === "gain" ? 2 : 1.8));
  const fat = Math.round(weight * 0.9);
  const carb = Math.round((cal - protein * 4 - fat * 9) / 4);
  return { cal: Math.round(cal), p: protein, f: fat, c: Math.max(carb, 50) };
}

/* ============================================================
   4. ГЕНЕРАТОР ПЛАНА
   ============================================================ */
function calcExerciseParams(exercise, user) {
  const goal = user.goal;
  const level = state.level || "novice";
  const goalMod = {
    lose: { sets: 1, reps: 1.5, rest: 45 },
    gain: { sets: 1.5, reps: 0.7, rest: 90 },
    keep: { sets: 1.2, reps: 1, rest: 60 }
  };
  const levelMod = {
    novice: { sets: 0.8, reps: 0.8 },
    middle: { sets: 1, reps: 1 },
    pro: { sets: 1.3, reps: 1.2 }
  };
  const gm = goalMod[goal] || goalMod.keep;
  const lm = levelMod[level] || levelMod.novice;
  const sets = Math.max(2, Math.round(exercise.baseSets * gm.sets * lm.sets));
  const reps = Math.max(4, Math.round(exercise.baseReps * gm.reps * lm.reps));
  const rest = gm.rest;
  return { sets, reps, rest, unit: exercise.unit };
}

function generateWorkoutPlan(user) {
  const template = WORKOUT_TEMPLATES[user.goal];
  if (!template) return null;
  const plan = {
    title: template.title,
    description: template.description,
    generatedAt: new Date().toISOString(),
    days: []
  };
  template.days.forEach(dayTemplate => {
    const day = {
      dayNum: dayTemplate.dayNum,
      day: dayTemplate.day,
      focus: dayTemplate.focus,
      icon: dayTemplate.icon,
      isRest: dayTemplate.exercises.length === 0,
      exercises: []
    };
    dayTemplate.exercises.forEach(exId => {
      const ex = EXERCISES.find(e => e.id === exId);
      if (!ex) return;
      if (user.place === "home" && ex.place === "gym") {
        const homeAlt = EXERCISES.find(e =>
          e.place === "any" && e.muscle === ex.muscle && e.type === ex.type
        );
        if (homeAlt) {
          const params = calcExerciseParams(homeAlt, user);
          day.exercises.push({ ...homeAlt, ...params, originalId: ex.id });
        }
        return;
      }
      if (user.place === "street" && ex.place === "gym") {
        const streetAlt = EXERCISES.find(e =>
          (e.place === "street" || e.place === "any") &&
          e.muscle === ex.muscle && e.type === ex.type
        );
        if (streetAlt) {
          const params = calcExerciseParams(streetAlt, user);
          day.exercises.push({ ...streetAlt, ...params, originalId: ex.id });
        }
        return;
      }
      const params = calcExerciseParams(ex, user);
      day.exercises.push({ ...ex, ...params });
    });
    plan.days.push(day);
  });
  return plan;
}

function getTodayIndex() {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

/* ============================================================
   5. ЭКРАН «МОЙ ПЛАН»
   ============================================================ */
function renderMyPlan() {
  if (!state.user) return;
  if (!state.workoutPlan) {
    state.workoutPlan = generateWorkoutPlan(state.user);
    saveLocal();
  }
  const box = document.getElementById("my-plan-content");
  if (!box) return;
  const todayIdx = getTodayIndex();
  const plan = state.workoutPlan;

  let html = `
    <div class="card" style="background:linear-gradient(135deg,rgba(168,85,247,.15),rgba(6,182,212,.1))">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <div style="font-size:36px">🏋️</div>
        <div style="flex:1">
          <div style="font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Твой план</div>
          <div style="font-weight:800;font-size:18px">${plan.title}</div>
        </div>
      </div>
      <p style="font-size:13px;color:var(--text-dim);margin-bottom:12px">${plan.description}</p>
      <div class="btn-row">
        <button class="btn small secondary" onclick="regeneratePlan()">🔄 Другой план</button>
        <button class="btn small secondary" onclick="changeLevel()">🎯 ${state.level === "novice" ? "Новичок" : state.level === "middle" ? "Средний" : "Продвинутый"}</button>
      </div>
    </div>
  `;

  plan.days.forEach((day, idx) => {
    const isToday = idx === todayIdx;
    const doneKey = `${new Date().toISOString().slice(0,10)}_plan_${idx}`;
    const isDone = state.workoutLog[doneKey];

    html += `<div class="card" style="${isToday ? "border:2px solid var(--accent-1);box-shadow:0 0 30px rgba(168,85,247,.4);" : ""}">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:${day.exercises.length ? "14px" : "0"}">
        <div style="width:48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;background:${day.isRest ? "rgba(251,146,60,.15)" : "linear-gradient(135deg,rgba(168,85,247,.25),rgba(6,182,212,.2))"};flex-shrink:0;border:1px solid rgba(255,255,255,.08)">${day.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;font-size:16px">${day.day}</div>
            ${isToday ? '<span class="badge info" style="font-size:10px">Сегодня</span>' : ''}
            ${isDone ? '<span class="badge ok" style="font-size:10px">✓</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:2px">${day.focus}</div>
        </div>
      </div>`;

    if (day.exercises.length) {
      day.exercises.forEach(ex => {
        const repsText = ex.unit === "сек"
          ? `${ex.reps} сек`
          : ex.unit === "мин"
          ? `${ex.reps} мин`
          : `${ex.reps} раз`;
        const setsText = ex.unit === "мин" ? "" : `<b>${ex.sets} подход${ex.sets === 1 ? "" : ex.sets < 5 ? "а" : "ов"}</b> × `;

        html += `<div style="padding:12px;background:var(--bg-glass-light);border:1px solid rgba(255,255,255,.05);border-radius:14px;margin-bottom:8px">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:26px;flex-shrink:0">${ex.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px;margin-bottom:4px">${ex.name}</div>
              <div style="font-size:13px;color:var(--text-dim);margin-bottom:6px">
                ${setsText}${repsText}${ex.unit === "мин" ? "" : ` · отдых ${ex.rest} сек`}
              </div>
              <div style="font-size:12px;color:var(--text-mute);line-height:1.5">${ex.desc}</div>
            </div>
          </div>
        </div>`;
      });

      html += `<button class="btn small ${isDone ? "secondary" : ""}" onclick="markPlanDone(${idx})" style="width:100%;margin-top:10px">
        ${isDone ? "✓ Выполнено" : "Отметить выполненным"}
      </button>`;
    }

    html += `</div>`;
  });

  box.innerHTML = html;
}

window.regeneratePlan = function () {
  state.workoutPlan = generateWorkoutPlan(state.user);
  saveLocal();
  renderMyPlan();
  toast("План обновлён 🔄", "ok");
};

window.changeLevel = function () {
  const levels = ["novice", "middle", "pro"];
  const names = { novice: "Новичок", middle: "Средний", pro: "Продвинутый" };
  const current = levels.indexOf(state.level);
  const next = (current + 1) % levels.length;
  state.level = levels[next];
  state.workoutPlan = generateWorkoutPlan(state.user);
  saveLocal();
  renderMyPlan();
  toast(`Уровень: ${names[state.level]}`, "ok");
};

window.markPlanDone = function (idx) {
  const t = new Date().toISOString().slice(0, 10);
  const k = `${t}_plan_${idx}`;
  state.workoutLog[k] = !state.workoutLog[k];
  saveLocal();
  renderMyPlan();
  if (state.workoutLog[k]) toast("Молодец! 💪", "ok");
  const u = getCurrentUser();
  if (u) saveWorkoutLogToCloud(u.uid, state.workoutLog);
};

/* ============================================================
   6. ОНБОРДИНГ
   ============================================================ */
window.obNext = function (step) {
  if (step === 3) {
    const age = +document.getElementById("ob-age").value;
    const h = +document.getElementById("ob-height").value;
    const w = +document.getElementById("ob-weight").value;
    if (!age || age < 10 || age > 100) return toast("Введи возраст", "bad");
    if (!h || h < 100 || h > 250) return toast("Введи рост", "bad");
    if (!w || w < 30 || w > 300) return toast("Введи вес", "bad");
  }
  document.querySelectorAll("#screen-onboarding .card").forEach(c => c.classList.add("hidden"));
  document.getElementById("ob-step-" + step).classList.remove("hidden");
  document.getElementById("ob-progress").style.width = (step * 33.3) + "%";
};

window.finishOnboarding = async function () {
  const name = document.getElementById("ob-name").value.trim() || "Друг";
  const sex = document.querySelector('input[name="ob-sex"]:checked').value;
  const age = +document.getElementById("ob-age").value;
  const height = +document.getElementById("ob-height").value;
  const weight = +document.getElementById("ob-weight").value;
  const goal = document.querySelector('input[name="ob-goal"]:checked').value;
  const activity = +document.getElementById("ob-activity").value;
  const place = document.getElementById("ob-place").value;
  const level = document.querySelector('input[name="ob-level"]:checked')?.value || "novice";

  state.user = { name, sex, age, height, weight, goal, activity, place };
  state.level = level;
  state.norm = calcNorm(state.user);
  state.workoutPlan = generateWorkoutPlan(state.user);
  saveLocal();
  const u = getCurrentUser();
  if (u) await saveProfileToCloud(u.uid, state.user);
  document.getElementById("nav").classList.remove("hidden");
  showScreen("dashboard");
  toast("Профиль создан! 🚀", "ok");
};

window.editProfile = function () {
  if (!state.user) return;
  document.getElementById("nav").classList.add("hidden");
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-onboarding").classList.add("active");
  document.getElementById("ob-step-1").classList.remove("hidden");
  document.getElementById("ob-step-2").classList.add("hidden");
  document.getElementById("ob-step-3").classList.add("hidden");
  document.getElementById("ob-progress").style.width = "20%";
  document.getElementById("ob-name").value = state.user.name;
  document.querySelector(`input[name="ob-sex"][value="${state.user.sex}"]`).checked = true;
  document.getElementById("ob-age").value = state.user.age;
  document.getElementById("ob-height").value = state.user.height;
  document.getElementById("ob-weight").value = state.user.weight;
  document.querySelector(`input[name="ob-goal"][value="${state.user.goal}"]`).checked = true;
  document.getElementById("ob-activity").value = state.user.activity;
  document.getElementById("ob-place").value = state.user.place || "any";
  const lvlEl = document.querySelector(`input[name="ob-level"][value="${state.level}"]`);
  if (lvlEl) lvlEl.checked = true;
};

/* ============================================================
   7. DASHBOARD
   ============================================================ */
function renderDashboard() {
  if (!state.user || !state.norm) return;
  const { name, goal } = state.user;
  const gT = { lose: "похудеть", gain: "набрать массу", keep: "поддерживать форму" }[goal];
  document.getElementById("dash-greeting").textContent = `Привет, ${name}! 👋`;
  document.getElementById("dash-sub").textContent = `Твоя цель: ${gT}`;
  animateNumber("dash-calories", state.norm.cal);
  animateNumber("dash-protein", state.norm.p);
  animateNumber("dash-fat", state.norm.f);
  animateNumber("dash-carb", state.norm.c);
  renderRing();
  renderWeightChart();
  renderTodayWorkout();
}

function renderTodayWorkout() {
  const box = document.getElementById("today-workout");
  if (!box || !state.workoutPlan) return;
  const todayIdx = getTodayIndex();
  const day = state.workoutPlan.days[todayIdx];
  if (!day) { box.innerHTML = ""; return; }

  if (day.isRest) {
    box.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,rgba(251,146,60,.15),rgba(244,63,94,.1))">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="font-size:40px">😴</div>
          <div style="flex:1">
            <div style="font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Сегодня</div>
            <div style="font-weight:700;font-size:16px">День отдыха</div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:4px">Прогулка или растяжка</div>
          </div>
        </div>
      </div>`;
    return;
  }

  let exHtml = day.exercises.slice(0, 3).map(ex => {
    const repsText = ex.unit === "сек" ? `${ex.reps} сек` :
                     ex.unit === "мин" ? `${ex.reps} мин` : `${ex.reps} раз`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px">
      <span>${ex.icon}</span>
      <span style="flex:1">${ex.name}</span>
      <span style="color:var(--text-dim);font-weight:600">${ex.sets}×${repsText}</span>
    </div>`;
  }).join("");

  if (day.exercises.length > 3) {
    exHtml += `<div style="font-size:12px;color:var(--text-dim);padding-top:8px">+${day.exercises.length - 3} упражнений</div>`;
  }

  box.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,rgba(168,85,247,.15),rgba(6,182,212,.1))">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:40px">${day.icon}</div>
        <div style="flex:1">
          <div style="font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px">Тренировка сегодня</div>
          <div style="font-weight:700;font-size:16px">${day.focus}</div>
        </div>
      </div>
      ${exHtml}
      <button class="btn small" onclick="showScreen('my-plan')" style="width:100%;margin-top:12px">📋 Открыть план на неделю</button>
    </div>`;
}

function renderRing() {
  if (!state.norm) return;
  const total = state.norm.p * 4 + state.norm.f * 9 + state.norm.c * 4;
  const circ = 2 * Math.PI * 70;
  const pL = circ * (state.norm.p * 4) / total;
  const fL = circ * (state.norm.f * 9) / total;
  const cL = circ * (state.norm.c * 4) / total;
  const p = document.getElementById("ring-p");
  const f = document.getElementById("ring-f");
  const c = document.getElementById("ring-c");
  if (!p) return;
  p.style.strokeDasharray = `${pL} ${circ}`;
  p.style.strokeDashoffset = 0;
  f.style.strokeDasharray = `${fL} ${circ}`;
  f.style.strokeDashoffset = -pL;
  c.style.strokeDasharray = `${cL} ${circ}`;
  c.style.strokeDashoffset = -(pL + fL);
}

/* ============================================================
   8. ГРАФИК ВЕСА
   ============================================================ */
function renderWeightChart() {
  const cv = document.getElementById("weight-chart");
  const em = document.getElementById("weight-empty");
  const info = document.getElementById("weight-info");
  if (!cv) return;

  if (!state.measurements.length) {
    cv.classList.add("hidden");
    if (em) em.classList.remove("hidden");
    if (info) info.classList.add("hidden");
    return;
  }

  cv.classList.remove("hidden");
  if (em) em.classList.add("hidden");
  if (info) info.classList.remove("hidden");

  const sorted = [...state.measurements].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (info) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const diff = (last.weight - first.weight).toFixed(1);
    const diffClass = diff < 0 ? "ok" : diff > 0 ? "bad" : "warn";
    const diffText = diff > 0 ? `+${diff}` : diff;

    info.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="text-align:center;padding:10px;background:var(--bg-glass-light);border-radius:12px;border:1px solid rgba(255,255,255,.06)">
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Старт</div>
          <div style="font-weight:700;font-size:16px;margin-top:2px">${first.weight} кг</div>
        </div>
        <div style="text-align:center;padding:10px;background:var(--bg-glass-light);border-radius:12px;border:1px solid rgba(255,255,255,.06)">
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Сейчас</div>
          <div style="font-weight:700;font-size:16px;margin-top:2px">${last.weight} кг</div>
        </div>
        <div style="text-align:center;padding:10px;background:var(--bg-glass-light);border-radius:12px;border:1px solid rgba(255,255,255,.06)">
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Разница</div>
          <div class="badge ${diffClass}" style="margin-top:4px">${diffText} кг</div>
        </div>
      </div>`;
  }

  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  const W = rect.width;
  const H = 240;

  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.height = H + "px";
  ctx.scale(dpr, dpr);

  const padLeft = 44;
  const padRight = 16;
  const padTop = 24;
  const padBottom = 40;

  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const weights = sorted.map(m => m.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const range = maxW - minW || 1;

  const scaleMin = minW - range * 0.15;
  const scaleMax = maxW + range * 0.15;
  const scaleRange = scaleMax - scaleMin;

  const points = sorted.map((m, i) => ({
    x: padLeft + (chartW * i / Math.max(sorted.length - 1, 1)),
    y: padTop + chartH * (1 - (m.weight - scaleMin) / scaleRange),
    weight: m.weight,
    date: m.date
  }));

  ctx.clearRect(0, 0, W, H);

  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const value = scaleMax - (scaleRange * i / gridCount);
    const y = padTop + chartH * (i / gridCount);

    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(W - padRight, y);
    ctx.strokeStyle = "rgba(255,255,255,.06)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#a89ec9";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(value.toFixed(1), padLeft - 8, y);
  }

  const totalDiff = points[points.length - 1].weight - points[0].weight;
  let lineColorStart, lineColorEnd, pointColor;
  if (totalDiff < -0.3) {
    lineColorStart = "#10b981";
    lineColorEnd = "#06b6d4";
    pointColor = "#10b981";
  } else if (totalDiff > 0.3) {
    lineColorStart = "#fb923c";
    lineColorEnd = "#f43f5e";
    pointColor = "#fb923c";
  } else {
    lineColorStart = "#a855f7";
    lineColorEnd = "#06b6d4";
    pointColor = "#a855f7";
  }

  const lineGrad = ctx.createLinearGradient(padLeft, 0, W - padRight, 0);
  lineGrad.addColorStop(0, lineColorStart);
  lineGrad.addColorStop(1, lineColorEnd);

  if (points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
    }
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    const fillGrad = ctx.createLinearGradient(0, padTop, 0, H - padBottom);
    fillGrad.addColorStop(0, lineColorStart + "44");
    fillGrad.addColorStop(1, lineColorStart + "00");
    ctx.beginPath();
    ctx.moveTo(points[0].x, H - padBottom);
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpX, prev.y, cpX, curr.y, curr.x, curr.y);
    }
    ctx.lineTo(points[points.length - 1].x, H - padBottom);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();
  } else if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, 6, 0, Math.PI * 2);
    ctx.fillStyle = pointColor;
    ctx.fill();
  }

  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = pointColor + "22";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = pointColor;
    ctx.fill();

    const showLabel = i === 0 || i === points.length - 1 || points.length <= 5;
    if (showLabel) {
      ctx.fillStyle = "#f5f3ff";
      ctx.font = "bold 11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(p.weight.toFixed(1), p.x, p.y - 12);
    }

    const d = new Date(p.date);
    const dateStr = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    ctx.fillStyle = "#6b6490";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(dateStr, p.x, H - padBottom + 8);
  });
}

/* ============================================================
   9. РАЦИОН — С ИСПРАВЛЕННОЙ КНОПКОЙ "ДРУГОЙ ВАРИАНТ"
   ============================================================ */
window.generateMealPlan = function (shuffle = false) {
  if (!state.norm || !state.user) return;
  const goal = state.user.goal;
  const t = state.norm;
  const dist = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };

  // Исключаем блюда из предыдущего рациона
  const currentIds = state.currentMealPlan
    ? Object.values(state.currentMealPlan).map(r => r?.id).filter(Boolean)
    : [];

  const meals = {
    breakfast: pickRecipe("breakfast", t.cal * dist.breakfast, goal, 0, currentIds),
    lunch: pickRecipe("lunch", t.cal * dist.lunch, goal, 1, currentIds),
    dinner: pickRecipe("dinner", t.cal * dist.dinner, goal, 2, currentIds),
    snack: pickRecipe("snack", t.cal * dist.snack, goal, 3, currentIds)
  };

  state.currentMealPlan = meals;
  state.planSeed = (state.planSeed || 0) + 1;
  saveLocal();

  const list = document.getElementById("nutri-list");
  if (!list) return;
  list.innerHTML = "";
  let tc = 0, tp = 0, tf = 0, tch = 0;
  const lbl = { breakfast: "🌅 Завтрак", lunch: "☀️ Обед", dinner: "🌙 Ужин", snack: "🍎 Перекус" };

  Object.keys(meals).forEach(k => {
    const r = meals[k];
    if (!r) return;
    tc += r.cal; tp += r.p; tf += r.f; tch += r.c;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:32px">${r.icon}</div>
        <div style="flex:1"><div style="font-size:12px;color:var(--text-dim)">${lbl[k]}</div><div style="font-weight:700;font-size:16px">${r.name}</div></div>
        <div style="text-align:right"><div style="font-weight:700">${r.cal}</div><div style="font-size:11px;color:var(--text-dim)">ккал</div></div>
      </div>
      <div class="macros" style="margin-bottom:12px">
        <div class="macro protein"><div class="val" style="font-size:14px">${r.p}г</div><div class="name">Б</div></div>
        <div class="macro fat"><div class="val" style="font-size:14px">${r.f}г</div><div class="name">Ж</div></div>
        <div class="macro carb"><div class="val" style="font-size:14px">${r.c}г</div><div class="name">У</div></div>
      </div>
      <button class="btn small secondary" onclick="openRecipe('${r.id}')">📖 Открыть рецепт</button>`;
    list.appendChild(card);
  });

  const totalCalEl = document.getElementById("nutri-total-cal");
  const totalSubEl = document.getElementById("nutri-total-sub");
  if (totalCalEl) totalCalEl.textContent = tc;
  if (totalSubEl) totalSubEl.textContent =
    `Б:${tp}г · Ж:${tf}г · У:${tch}г · норма ${state.norm.cal} ккал`;

  if (shuffle) toast("Новый рацион! 🍽️", "ok");
};

function pickRecipe(meal, target, goal, slot, exclude = []) {
  let pool = RECIPES.filter(r => r.meal === meal);
  if (!pool.length) return null;

  // Исключаем уже показанные блюда (если их осталось достаточно)
  if (exclude.length) {
    const filtered = pool.filter(r => !exclude.includes(r.id));
    if (filtered.length >= 2) pool = filtered;
  }

  // Оценка «похожести» на цель
  const sc = pool.map(r => {
    let s = Math.abs(r.cal - target);
    if (goal === "lose") s -= r.p * 2;
    if (goal === "gain") s -= r.cal * 0.1;
    return { r, s };
  });
  sc.sort((a, b) => a.s - b.s);

  // Берём ТОП-8 для большего разнообразия
  const top = sc.slice(0, Math.min(8, sc.length));

  // Случайный выбор каждый раз
  const rand = Math.floor(Math.random() * top.length);
  return top[rand].r;
}

/* ============================================================
   10. РЕЦЕПТЫ
   ============================================================ */
function renderRecipeList() {
  const chips = document.getElementById("recipe-chips");
  if (!chips) return;
  const cats = [
    { id: "all", n: "Все" },
    { id: "breakfast", n: "🌅 Завтраки" },
    { id: "lunch", n: "☀️ Обеды" },
    { id: "dinner", n: "🌙 Ужины" },
    { id: "snack", n: "🍎 Перекусы" },
    { id: "soup", n: "🍲 Супы" },
    { id: "smoothie", n: "🥤 Смузи" }
  ];
  chips.innerHTML = cats.map(c =>
    `<button class="chip ${state.recipeFilter === c.id ? "active" : ""}" onclick="setRecipeFilter('${c.id}')">${c.n}</button>`
  ).join("");
  const filtered = state.recipeFilter === "all" ? RECIPES : RECIPES.filter(r => r.meal === state.recipeFilter);
  const listEl = document.getElementById("recipe-list");
  if (!listEl) return;
  listEl.innerHTML = filtered.map(r => `
    <div class="card" style="cursor:pointer" onclick="openRecipe('${r.id}')">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:36px">${r.icon}</div>
        <div style="flex:1"><div style="font-weight:700;font-size:16px;margin-bottom:4px">${r.name}</div>
        <div style="font-size:12px;color:var(--text-dim)">${r.cal} ккал · Б${r.p} Ж${r.f} У${r.c}</div></div>
        <div style="font-size:24px;color:var(--text-dim)">›</div>
      </div>
    </div>`).join("");
}

window.setRecipeFilter = function (id) {
  state.recipeFilter = id;
  renderRecipeList();
};

window.openRecipe = function (id) {
  const r = RECIPES.find(x => x.id === id);
  if (!r) return;
  document.getElementById("recipe-detail").innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="font-size:56px">${r.icon}</div>
        <div><h1 style="margin-bottom:4px">${r.name}</h1>
        <div style="font-size:13px;color:var(--text-dim)">На ${r.servings} порцию</div></div>
      </div>
      <div class="macros four">
        <div class="macro"><div class="val">${r.cal}</div><div class="name">ккал</div></div>
        <div class="macro protein"><div class="val">${r.p}г</div><div class="name">Белки</div></div>
        <div class="macro fat"><div class="val">${r.f}г</div><div class="name">Жиры</div></div>
        <div class="macro carb"><div class="val">${r.c}г</div><div class="name">Углев</div></div>
      </div>
    </div>
    <div class="card"><h2>🛒 Ингредиенты</h2>
      ${r.ingredients.map(i => `<div class="ingr-row"><span class="name">${i.n}</span><span class="qty">${i.q}</span></div>`).join("")}
    </div>
    <div class="card"><h2>👨‍🍳 Как готовить</h2>
      ${r.steps.map((s, i) => `<div class="step"><div class="num">${i + 1}</div><div class="text">${s}</div></div>`).join("")}
    </div>`;
  showScreen("recipe");
};

/* ============================================================
   11. УПРАЖНЕНИЯ
   ============================================================ */
function renderExerciseList() {
  const chips = document.getElementById("exercise-chips");
  if (!chips) return;
  const places = [
    { id: "all", n: "Все" },
    { id: "home", n: "🏠 Дом" },
    { id: "street", n: "🌳 Улица" },
    { id: "gym", n: "🏋️ Зал" }
  ];
  chips.innerHTML = places.map(p =>
    `<button class="chip ${state.exerciseFilter === p.id ? "active" : ""}" onclick="setExerciseFilter('${p.id}')">${p.n}</button>`
  ).join("");
  const filtered = state.exerciseFilter === "all"
    ? EXERCISES
    : EXERCISES.filter(e => e.place === state.exerciseFilter || e.place === "any");
  const listEl = document.getElementById("exercise-list");
  if (!listEl) return;
  listEl.innerHTML = filtered.map(e => `
    <div class="card" style="cursor:pointer" onclick="openExercise('${e.id}')">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:32px">${e.icon}</div>
        <div style="flex:1"><div style="font-weight:700">${e.name}</div>
        <div style="font-size:12px;color:var(--text-dim)">${e.muscle} · ${e.baseSets}×${e.baseReps} ${e.unit}</div></div>
        <span class="badge info">${e.place === "home" ? "🏠" : e.place === "street" ? "🌳" : e.place === "gym" ? "🏋️" : "🌍"}</span>
      </div>
    </div>`).join("");
}

window.setExerciseFilter = function (id) {
  state.exerciseFilter = id;
  renderExerciseList();
};

window.openExercise = function (id) {
  const e = EXERCISES.find(x => x.id === id);
  if (!e) return;
  document.getElementById("recipe-detail").innerHTML = `
    <div class="card">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="font-size:56px">${e.icon}</div>
        <div><h1 style="margin-bottom:4px">${e.name}</h1>
        <div style="font-size:13px;color:var(--text-dim)">${e.muscle}</div></div>
      </div>
      <div class="macros" style="grid-template-columns:1fr 1fr">
        <div class="macro"><div class="val" style="font-size:16px">${e.baseSets}×${e.baseReps} ${e.unit}</div><div class="name">Базовый объём</div></div>
        <div class="macro"><div class="val" style="font-size:16px">${e.place === "home" ? "Дом" : e.place === "street" ? "Улица" : e.place === "gym" ? "Зал" : "Везде"}</div><div class="name">Место</div></div>
      </div>
    </div>
    <div class="card"><h2>📝 Как выполнять</h2><p style="font-size:15px;line-height:1.7">${e.desc}</p></div>`;
  showScreen("recipe");
};

/* ============================================================
   12. ЗАМЕРЫ
   ============================================================ */
window.saveMeasurement = async function () {
  const w = +document.getElementById("m-weight").value;
  if (!w || w < 30 || w > 300) return toast("Введи вес", "bad");
  const m = {
    date: new Date().toISOString().slice(0, 10),
    weight: w,
    chest: +document.getElementById("m-chest").value || 0,
    waist: +document.getElementById("m-waist").value || 0,
    hips: +document.getElementById("m-hips").value || 0,
    arm: +document.getElementById("m-arm").value || 0
  };
  state.measurements.push(m);
  state.user.weight = w;
  state.norm = calcNorm(state.user);
  state.workoutPlan = generateWorkoutPlan(state.user);
  saveLocal();
  const u = getCurrentUser();
  if (u) {
    await saveMeasurementToCloud(u.uid, m);
    await saveProfileToCloud(u.uid, state.user);
  }
  ["m-weight", "m-chest", "m-waist", "m-hips", "m-arm"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  renderMeasurements();
  renderWeightChart();
  toast("Замер сохранён 📏", "ok");
};

function renderMeasurements() {
  const box = document.getElementById("measure-history");
  if (!box) return;
  if (!state.measurements.length) {
    box.innerHTML = `<div class="empty"><div class="big">📏</div><div>Пока нет замеров</div></div>`;
    return;
  }
  const sorted = [...state.measurements].reverse();
  box.innerHTML = sorted.map((m, i) => {
    const prev = sorted[i + 1];
    const d = prev ? (m.weight - prev.weight).toFixed(1) : null;
    const dt = d === null ? ""
      : d > 0 ? `<span class="badge bad">+${d}</span>`
      : d < 0 ? `<span class="badge ok">${d}</span>`
      : `<span class="badge warn">0</span>`;
    return `<div class="list-item"><div class="icon">📅</div>
      <div class="info"><div class="title">${m.date}</div>
      <div class="sub">Грудь ${m.chest || "—"} · Талия ${m.waist || "—"} · Бёдра ${m.hips || "—"}</div></div>
      <div class="right"><div class="num">${m.weight} кг</div><div class="unit">${dt}</div></div></div>`;
  }).join("");
}

/* ============================================================
   13. ПОИСК
   ============================================================ */
function initSearch() {
  const sel = document.getElementById("photo-product-select");
  if (sel && !sel.options.length) {
    sel.innerHTML = PRODUCTS.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
  }
  renderSearchCats();
}

function renderSearchCats() {
  const cats = [
    { id: "all", n: "Все" }, { id: "grain", n: "🌾 Крупы" },
    { id: "meat", n: "🍗 Мясо" }, { id: "fish", n: "🐟 Рыба" },
    { id: "dairy", n: "🥛 Молочка" }, { id: "egg", n: "🥚 Яйца" },
    { id: "veg", n: "🥦 Овощи" }, { id: "fruit", n: "🍎 Фрукты" },
    { id: "fat", n: "🥜 Жиры" }, { id: "semi", n: "🌭 Полуфаб" },
    { id: "sauce", n: "🥫 Соусы" }, { id: "sweet", n: "🍫 Сладкое" },
    { id: "drink", n: "🥤 Напитки" }, { id: "fast", n: "🍔 Фастфуд" },
    { id: "sport", n: "💪 Спортпит" }
  ];
  const box = document.getElementById("search-cats");
  if (!box) return;
  box.innerHTML = cats.map(c =>
    `<button class="chip ${state.searchCat === c.id ? "active" : ""}" onclick="setSearchCat('${c.id}')">${c.n}</button>`
  ).join("");
}

window.setSearchCat = function (id) {
  state.searchCat = id;
  renderSearchCats();
  window.liveSearch();
};

window.liveSearch = function () {
  const input = document.getElementById("search-input");
  if (!input) return;
  const q = input.value.trim().toLowerCase();
  let found = PRODUCTS;
  if (state.searchCat !== "all") found = found.filter(p => p.cat === state.searchCat);
  if (q.length >= 1) found = found.filter(p => p.name.toLowerCase().includes(q));
  if (q.length < 1 && state.searchCat === "all") {
    const r = document.getElementById("search-result");
    if (r) r.innerHTML = "";
    return;
  }
  found = found.slice(0, 30);
  if (found.length) renderSearchResults(found, q || state.searchCat);
  else renderSearchResults([], q);
};

window.searchProduct = function () {
  const input = document.getElementById("search-input");
  if (!input) return;
  const q = input.value.trim().toLowerCase();
  if (!q) return toast("Введи название", "bad");
  let found = PRODUCTS;
  if (state.searchCat !== "all") found = found.filter(p => p.cat === state.searchCat);
  found = found.filter(p => p.name.toLowerCase().includes(q));
  renderSearchResults(found, q);
};

function renderSearchResults(results, query) {
  const box = document.getElementById("search-result");
  if (!box) return;
  if (!results.length) {
    box.innerHTML = `<div class="card"><div class="empty"><div class="big">🤔</div>
      <div>Ничего не найдено</div>
      <div style="margin-top:12px;font-size:13px">Попробуй поиск онлайн 🌐</div></div></div>`;
    return;
  }
  box.innerHTML = results.map(p => {
    const v = getVerdict(p);
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:28px">${getCatIcon(p.cat)}</div>
        <div style="flex:1"><div style="font-weight:700;font-size:16px">${p.name}</div>
        <div style="font-size:12px;color:var(--text-dim)">на 100 г</div></div>
        <span class="badge ${v.cls}">${v.text}</span>
      </div>
      <div class="macros four">
        <div class="macro"><div class="val" style="font-size:16px">${p.cal}</div><div class="name">ккал</div></div>
        <div class="macro protein"><div class="val" style="font-size:16px">${p.p}</div><div class="name">Б</div></div>
        <div class="macro fat"><div class="val" style="font-size:16px">${p.f}</div><div class="name">Ж</div></div>
        <div class="macro carb"><div class="val" style="font-size:16px">${p.c}</div><div class="name">У</div></div>
      </div>
      <div style="margin-top:12px;font-size:13px;color:var(--text-dim)">${v.msg}</div>
    </div>`;
  }).join("");
}

function getCatIcon(c) {
  return { grain: "🌾", meat: "🍗", fish: "🐟", dairy: "🥛", egg: "🥚",
    veg: "🥦", fruit: "🍎", fat: "🥜", semi: "🌭", sauce: "🥫",
    sweet: "🍫", drink: "🥤", fast: "🍔", sport: "💪", other: "🍽️" }[c] || "🍽️";
}

function getVerdict(p) {
  if (!state.user) return { text: "—", cls: "warn", msg: "Заполни профиль" };
  const goal = state.user.goal;
  if (goal === "lose") {
    if (p.cal > 400 && p.c < 20) return { text: "❌ Не стоит", cls: "bad", msg: "Очень калорийно и мало пользы." };
    if (p.cal < 100 && p.p > 5) return { text: "✅ Отлично", cls: "ok", msg: "Мало калорий, много белка." };
    if (p.cal < 150) return { text: "✅ Можно", cls: "ok", msg: "Низкокалорийный продукт." };
    if (p.cal < 300) return { text: "⚠️ Умеренно", cls: "warn", msg: "Следи за порцией." };
    return { text: "⚠️ Осторожно", cls: "warn", msg: "Калорийно. Маленькими порциями." };
  }
  if (goal === "gain") {
    if (p.cal > 300 && p.p > 10) return { text: "✅ Отлично", cls: "ok", msg: "Калорийно и белково." };
    if (p.cal > 200) return { text: "✅ Можно", cls: "ok", msg: "Хороший источник энергии." };
    return { text: "⚠️ Мало", cls: "warn", msg: "Низкокалорийно. Добавь посытнее." };
  }
  if (p.cal > 500) return { text: "⚠️ Осторожно", cls: "warn", msg: "Очень калорийно." };
  if (p.p > 10 || p.cal < 150) return { text: "✅ Хорошо", cls: "ok", msg: "Сбалансированный выбор." };
  return { text: "⚠️ Умеренно", cls: "warn", msg: "Нормально, без фанатизма." };
}

window.handlePhoto = function (e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const img = document.getElementById("photo-preview");
    if (img) {
      img.src = ev.target.result;
      img.classList.remove("hidden");
    }
    const res = document.getElementById("photo-result");
    if (res) res.classList.remove("hidden");
    window.analyzePhoto();
    toast("Фото загружено! 📷", "ok");
  };
  r.readAsDataURL(f);
};

window.analyzePhoto = function () {
  const sel = document.getElementById("photo-product-select");
  if (!sel) return;
  const n = sel.value;
  const p = PRODUCTS.find(x => x.name === n);
  if (!p) return;
  const v = getVerdict(p);
  const box = document.getElementById("photo-verdict");
  if (!box) return;
  box.innerHTML = `
    <div class="card" style="margin:0">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:32px">${getCatIcon(p.cat)}</div>
        <div style="flex:1"><div style="font-weight:700;font-size:18px">${p.name}</div>
        <div style="font-size:12px;color:var(--text-dim)">на 100 г</div></div>
        <span class="badge ${v.cls}">${v.text}</span>
      </div>
      <div class="macros four">
        <div class="macro"><div class="val">${p.cal}</div><div class="name">ккал</div></div>
        <div class="macro protein"><div class="val">${p.p}</div><div class="name">Б</div></div>
        <div class="macro fat"><div class="val">${p.f}</div><div class="name">Ж</div></div>
        <div class="macro carb"><div class="val">${p.c}</div><div class="name">У</div></div>
      </div>
      <div style="margin-top:12px;font-size:13px;color:var(--text-dim)">${v.msg}</div>
    </div>`;
};

window.searchFromAPI = async function () {
  const input = document.getElementById("search-input");
  if (!input) return;
  const q = input.value.trim();
  if (!q) return toast("Введи название", "bad");
  toast("Ищу в интернете... 🌐");
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10&lc=ru`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.products || !data.products.length) return toast("Ничего не найдено", "bad");
    const results = data.products
      .filter(p => p.nutriments && p.nutriments["energy-kcal_100g"] != null)
      .map(p => ({
        name: p.product_name || p.product_name_ru || "Без названия",
        cal: Math.round(p.nutriments["energy-kcal_100g"] || 0),
        p: +(p.nutriments.proteins_100g || 0).toFixed(1),
        f: +(p.nutriments.fat_100g || 0).toFixed(1),
        c: +(p.nutriments.carbohydrates_100g || 0).toFixed(1),
        cat: "other"
      }));
    if (!results.length) return toast("Нет данных", "bad");
    renderSearchResults(results, q);
    toast(`Найдено: ${results.length} 🌐`, "ok");
  } catch (e) {
    toast("Ошибка поиска", "bad");
  }
};

/* ============================================================
   14. КОНСТРУКТОР БЛЮД
   ============================================================ */
function renderMealBuilder() {
  renderBuilderItems();
  updateBuilderTotals();
}

window.addIngredientToMeal = function () {
  const sel = document.getElementById("mb-product-select");
  const gramsInput = document.getElementById("mb-grams");
  const grams = +gramsInput?.value || 100;
  if (!sel || !sel.value) return toast("Выбери продукт", "bad");
  const p = PRODUCTS.find(x => x.name === sel.value);
  if (!p) return;
  state.currentMealItems.push({
    name: p.name,
    grams: grams,
    cal: Math.round(p.cal * grams / 100),
    p: +(p.p * grams / 100).toFixed(1),
    f: +(p.f * grams / 100).toFixed(1),
    c: +(p.c * grams / 100).toFixed(1)
  });
  renderBuilderItems();
  updateBuilderTotals();
  if (gramsInput) gramsInput.value = 100;
  toast("Добавлено ✅", "ok");
};

window.removeIngredientFromMeal = function (idx) {
  state.currentMealItems.splice(idx, 1);
  renderBuilderItems();
  updateBuilderTotals();
};

function renderBuilderItems() {
  const box = document.getElementById("mb-items");
  if (!box) return;
  if (!state.currentMealItems.length) {
    box.innerHTML = `<div class="empty" style="padding:20px"><div>Пока пусто. Добавь первый ингредиент 👆</div></div>`;
    return;
  }
  box.innerHTML = state.currentMealItems.map((it, i) => `
    <div class="list-item">
      <div class="info"><div class="title">${it.name}</div>
      <div class="sub">${it.grams} г · ${it.cal} ккал · Б${it.p} Ж${it.f} У${it.c}</div></div>
      <button class="btn small ghost" onclick="removeIngredientFromMeal(${i})">🗑️</button>
    </div>`).join("");
}

function updateBuilderTotals() {
  let cal = 0, p = 0, f = 0, c = 0;
  state.currentMealItems.forEach(it => { cal += it.cal; p += it.p; f += it.f; c += it.c; });
  const e1 = document.getElementById("mb-cal");
  const e2 = document.getElementById("mb-p");
  const e3 = document.getElementById("mb-f");
  const e4 = document.getElementById("mb-c");
  if (e1) e1.textContent = Math.round(cal);
  if (e2) e2.textContent = p.toFixed(1);
  if (e3) e3.textContent = f.toFixed(1);
  if (e4) e4.textContent = c.toFixed(1);
}

window.saveCustomMeal = async function () {
  const nameInput = document.getElementById("mb-name");
  const name = nameInput?.value.trim();
  if (!name) return toast("Введи название блюда", "bad");
  if (!state.currentMealItems.length) return toast("Добавь хотя бы один продукт", "bad");
  let cal = 0, p = 0, f = 0, c = 0;
  state.currentMealItems.forEach(it => { cal += it.cal; p += it.p; f += it.f; c += it.c; });
  const meal = {
    name, items: [...state.currentMealItems],
    cal: Math.round(cal),
    p: +p.toFixed(1), f: +f.toFixed(1), c: +c.toFixed(1),
    date: new Date().toISOString().slice(0, 10)
  };
  state.customMeals.push(meal);
  saveLocal();
  const u = getCurrentUser();
  if (u) {
    const res = await saveCustomMealToCloud(u.uid, meal);
    if (res.ok) meal.id = res.id;
  }
  state.currentMealItems = [];
  if (nameInput) nameInput.value = "";
  renderMealBuilder();
  toast("Блюдо сохранено! 🍽️", "ok");
  showScreen("my-meals");
};

function renderMyMeals() {
  const box = document.getElementById("my-meals-list");
  if (!box) return;
  if (!state.customMeals.length) {
    box.innerHTML = `<div class="empty"><div class="big">🍽️</div>
      <div>Пока нет своих блюд</div>
      <button class="btn" style="margin-top:16px" onclick="showScreen('meal-builder')">+ Создать блюдо</button></div>`;
    return;
  }
  box.innerHTML = state.customMeals.map((m, i) => `
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:32px">🍽️</div>
        <div style="flex:1"><div style="font-weight:700">${m.name}</div>
        <div style="font-size:12px;color:var(--text-dim)">${m.items.length} ингр. · ${m.date}</div></div>
        <div style="text-align:right"><div style="font-weight:700">${m.cal}</div>
        <div style="font-size:11px;color:var(--text-dim)">ккал</div></div>
      </div>
      <div class="macros" style="margin-bottom:12px">
        <div class="macro protein"><div class="val" style="font-size:14px">${m.p}г</div><div class="name">Б</div></div>
        <div class="macro fat"><div class="val" style="font-size:14px">${m.f}г</div><div class="name">Ж</div></div>
        <div class="macro carb"><div class="val" style="font-size:14px">${m.c}г</div><div class="name">У</div></div>
      </div>
      <button class="btn small ghost" onclick="deleteMyMeal(${i})">🗑️ Удалить</button>
    </div>`).join("");
}

window.deleteMyMeal = async function (idx) {
  const m = state.customMeals[idx];
  if (!m) return;
  if (!confirm(`Удалить "${m.name}"?`)) return;
  state.customMeals.splice(idx, 1);
  saveLocal();
  const u = getCurrentUser();
  if (u && m.id) await deleteCustomMealFromCloud(u.uid, m.id);
  renderMyMeals();
  toast("Удалено 🗑️");
};

/* ============================================================
   15. ПРОФИЛЬ
   ============================================================ */
function renderProfile() {
  if (!state.user) return;
  const u = state.user;
  const gT = { lose: "Похудеть", gain: "Набрать массу", keep: "Поддерживать" }[u.goal];
  const sT = u.sex === "m" ? "Мужской" : "Женский";
  const pT = { home: "Дома", street: "На улице", gym: "В зале", any: "Везде" }[u.place || "any"];
  const lT = { novice: "Новичок", middle: "Средний", pro: "Продвинутый" }[state.level];
  const email = state.fbUser?.email || "—";
  const box = document.getElementById("profile-info");
  if (!box) return;
  box.innerHTML = `
    <div class="list-item"><div class="icon">👤</div><div class="info"><div class="title">${u.name}</div><div class="sub">${sT}, ${u.age} лет</div></div></div>
    <div class="list-item"><div class="icon">📧</div><div class="info"><div class="title">${email}</div><div class="sub">Email</div></div></div>
    <div class="list-item"><div class="icon">📏</div><div class="info"><div class="title">${u.height} см · ${u.weight} кг</div><div class="sub">Рост и вес</div></div></div>
    <div class="list-item"><div class="icon">🎯</div><div class="info"><div class="title">${gT}</div><div class="sub">Цель</div></div></div>
    <div class="list-item"><div class="icon">🏋️</div><div class="info"><div class="title">${pT}</div><div class="sub">Место тренировок</div></div></div>
    <div class="list-item"><div class="icon">⭐</div><div class="info"><div class="title">${lT}</div><div class="sub">Уровень</div></div></div>
    <div class="list-item"><div class="icon">🔥</div><div class="info"><div class="title">${state.norm.cal} ккал</div><div class="sub">Б:${state.norm.p} · Ж:${state.norm.f} · У:${state.norm.c}</div></div></div>`;
}

window.exportData = function () {
  const b = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const u = URL.createObjectURL(b);
  const a = document.createElement("a");
  a.href = u;
  a.download = `fitlife_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(u);
  toast("Экспортировано 📤", "ok");
};

window.importData = function (e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (!d.user) return toast("Неверный файл", "bad");
      state = { ...state, ...d };
      state.norm = calcNorm(state.user);
      saveLocal();
      toast("Загружено 📥", "ok");
      document.getElementById("nav").classList.remove("hidden");
      showScreen("dashboard");
    } catch (err) {
      toast("Ошибка чтения", "bad");
    }
  };
  r.readAsText(f);
};

window.resetAll = function () {
  if (!confirm("Сбросить все локальные данные?")) return;
  localStorage.removeItem("fitlife_state");
  location.reload();
};

window.toggleTheme = function () {
  state.theme = state.theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  saveLocal();
  toast(state.theme === "dark" ? "🌙 Тёмная" : "☀️ Светлая");
};

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme || "dark");
}

/* ============================================================
   16. АУТЕНТИФИКАЦИЯ
   ============================================================ */
window.showAuth = function (mode) {
  document.getElementById("auth-login")?.classList.toggle("hidden", mode !== "login");
  document.getElementById("auth-register")?.classList.toggle("hidden", mode !== "register");
  document.getElementById("tab-login")?.classList.toggle("active", mode === "login");
  document.getElementById("tab-register")?.classList.toggle("active", mode === "register");
};

window.doRegister = async function () {
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass = document.getElementById("reg-pass").value;
  if (!name) return toast("Введи имя", "bad");
  if (!email) return toast("Введи email", "bad");
  if (pass.length < 6) return toast("Пароль минимум 6 символов", "bad");
  toast("Создаю аккаунт...");
  const res = await registerUser(email, pass, name);
  if (!res.ok) return toast(res.error, "bad");
  toast("Аккаунт создан! 🎉", "ok");
};

window.doLogin = async function () {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-pass").value;
  if (!email || !pass) return toast("Заполни все поля", "bad");
  toast("Вхожу...");
  const res = await loginUser(email, pass);
  if (!res.ok) return toast(res.error, "bad");
  toast("Добро пожаловать! 👋", "ok");
};

window.doGoogleLogin = async function () {
  toast("Открываю Google...");
  const res = await loginWithGoogle();
  if (!res.ok) return toast(res.error, "bad");
};

window.doLogout = async function () {
  if (!confirm("Выйти из аккаунта?")) return;
  await logoutUser();
  toast("Вы вышли 👋");
};

/* ============================================================
   17. ПОСЛЕ ВХОДА
   ============================================================ */
async function afterLogin(fbUser) {
  state.fbUser = fbUser;
  const sync = await syncAllFromCloud(fbUser.uid);
  if (sync.profile) {
    state.user = sync.profile;
    state.norm = calcNorm(state.user);
    state.workoutPlan = generateWorkoutPlan(state.user);
  }
  if (sync.measurements?.length) state.measurements = sync.measurements;
  if (sync.customMeals?.length) state.customMeals = sync.customMeals;
  if (sync.workoutLog) state.workoutLog = sync.workoutLog;
  saveLocal();

  document.getElementById("screen-auth").classList.remove("active");
  if (state.user) {
    document.getElementById("nav").classList.remove("hidden");
    showScreen("dashboard");
  } else {
    document.getElementById("screen-onboarding").classList.add("active");
  }
}

function showAuthScreen() {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-auth").classList.add("active");
  document.getElementById("nav").classList.add("hidden");
}

/* ============================================================
   18. PWA
   ============================================================ */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem("fitlife_install_dismissed")) {
    setTimeout(() => {
      document.getElementById("install-banner")?.classList.add("show");
    }, 3000);
  }
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  document.getElementById("install-banner")?.classList.remove("show");
  toast("Приложение установлено! 📲", "ok");
});

window.installApp = function () {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
      if (choice.outcome === "accepted") toast("Устанавливаем... 📲", "ok");
      deferredPrompt = null;
      document.getElementById("install-banner")?.classList.remove("show");
    });
  } else {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      alert("📲 Установка на iPhone:\n\n1. Нажми «Поделиться»\n2. Пролистай → «На экран Домой»\n3. «Добавить»");
    } else {
      alert("📲 Установка:\n\n1. Меню браузера (⋮)\n2. «Установить приложение»\n3. Подтверди");
    }
  }
};

window.dismissInstall = function () {
  document.getElementById("install-banner")?.classList.remove("show");
  localStorage.setItem("fitlife_install_dismissed", "1");
};

/* ============================================================
   19. ИНИЦИАЛИЗАЦИЯ
   ============================================================ */
async function init() {
  loadLocal();
  applyTheme();

  if (!localStorage.getItem("fitlife_state")) {
    const d = window.matchMedia("(prefers-color-scheme: dark)").matches;
    state.theme = d ? "dark" : "light";
    applyTheme();
  }

  const mbSel = document.getElementById("mb-product-select");
  if (mbSel) {
    mbSel.innerHTML = PRODUCTS.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
  }

  const redirectRes = await checkRedirectResult();
  if (redirectRes.ok && redirectRes.user) {
    toast("Добро пожаловать! 👋", "ok");
  }

  onAuthChange(user => {
    if (user) {
      afterLogin(user);
    } else {
      state.fbUser = null;
      if (state.user) {
        if (!state.workoutPlan) state.workoutPlan = generateWorkoutPlan(state.user);
        document.getElementById("nav").classList.remove("hidden");
        showScreen("dashboard");
      } else {
        showAuthScreen();
      }
    }
  });

  window.addEventListener("resize", () => {
    if (document.getElementById("screen-dashboard")?.classList.contains("active")) {
      renderWeightChart();
    }
  });

  const si = document.getElementById("search-input");
  if (si) si.addEventListener("keydown", e => { if (e.key === "Enter") window.searchProduct(); });
}

window.showScreen = showScreen;
window.toast = toast;

document.addEventListener("DOMContentLoaded", init);

console.log("✅ app.js v4.1 (исправлены кнопки) загружен");
