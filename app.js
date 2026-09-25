/* ============================================================
   FitLife — основная логика
   Версия: 2.0
   Файл: app.js
   
   Требует: data.js + firebase.js
   ============================================================ */

import {
  registerUser, loginUser, loginWithGoogle, logoutUser,
  onAuthChange, getCurrentUser,
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
  user: null,          // профиль пользователя (локальный)
  fbUser: null,        // Firebase user
  norm: null,          // норма КБЖУ
  measurements: [],
  customMeals: [],     // СВОИ блюда из конструктора
  workoutLog: {},
  theme: "dark",
  planSeed: 0,
  recipeFilter: "all",
  exerciseFilter: "all",
  searchCat: "all",
  currentMeal: null,   // блюдо, которое редактируется в конструкторе
  currentMealItems: [] // ингредиенты текущего блюда
};

function saveLocal() {
  try {
    localStorage.setItem("fitlife_state", JSON.stringify({
      user: state.user,
      measurements: state.measurements,
      customMeals: state.customMeals,
      workoutLog: state.workoutLog,
      theme: state.theme,
      planSeed: state.planSeed
    }));
  } catch (e) { console.warn("saveLocal error:", e); }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem("fitlife_state");
    if (raw) {
      const d = JSON.parse(raw);
      state = { ...state, ...d };
    }
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
  // Автообновление при показе экрана
  if (name === "dashboard") renderDashboard();
  if (name === "nutrition") generateMealPlan();
  if (name === "workout") renderWorkout();
  if (name === "measure") renderMeasurements();
  if (name === "profile") renderProfile();
  if (name === "search") initSearch();
  if (name === "recipes") renderRecipeList();
  if (name === "exercises") renderExerciseList();
  if (name === "meal-builder") renderMealBuilder();
  if (name === "my-meals") renderMyMeals();
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

function recalcAll() {
  if (!state.user) return;
  state.norm = calcNorm(state.user);
  const active = document.querySelector(".screen.active");
  if (!active) return;
  const id = active.id;
  if (id === "screen-dashboard") renderDashboard();
  if (id === "screen-nutrition") generateMealPlan();
  if (id === "screen-workout") renderWorkout();
  if (id === "screen-profile") renderProfile();
}

/* ============================================================
   4. ОНБОРДИНГ
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
  state.user = { name, sex, age, height, weight, goal, activity, place };
  state.norm = calcNorm(state.user);
  saveLocal();
  // Синхронизация с облаком
  const u = getCurrentUser();
  if (u) {
    await saveProfileToCloud(u.uid, state.user);
  }
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
};

/* ============================================================
   5. DASHBOARD
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

function renderWeightChart() {
  const cv = document.getElementById("weight-chart");
  const em = document.getElementById("weight-empty");
  if (!cv) return;
  if (!state.measurements.length) {
    cv.classList.add("hidden");
    em.classList.remove("hidden");
    return;
  }
  cv.classList.remove("hidden");
  em.classList.add("hidden");
  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = cv.getBoundingClientRect();
  cv.width = rect.width * dpr;
  cv.height = 200 * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = 200, pad = 30;
  const data = state.measurements.slice(-20);
  const ws = data.map(m => m.weight);
  const minW = Math.min(...ws) - 2, maxW = Math.max(...ws) + 2, range = maxW - minW || 1;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i <= 4; i++) {
    const y = pad + (H - pad * 2) * (i / 4);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  }
  const pts = data.map((m, i) => ({
    x: pad + (W - pad * 2) * (i / Math.max(data.length - 1, 1)),
    y: pad + (H - pad * 2) * (1 - (m.weight - minW) / range)
  }));
  const gr = ctx.createLinearGradient(0, pad, 0, H - pad);
  gr.addColorStop(0, "rgba(108,92,231,0.4)");
  gr.addColorStop(1, "rgba(108,92,231,0)");
  ctx.beginPath();
  ctx.moveTo(pts[0].x, H - pad);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, H - pad);
  ctx.closePath();
  ctx.fillStyle = gr; ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = "#6c5ce7"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.stroke();
  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#00d2a8"; ctx.fill();
  });
}

/* ============================================================
   6. РАЦИОН
   ============================================================ */
function generateMealPlan(shuffle = false) {
  if (!state.norm) return;
  if (shuffle) state.planSeed++;
  const goal = state.user.goal;
  const t = state.norm;
  const dist = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };
  const meals = {
    breakfast: pickRecipe("breakfast", t.cal * dist.breakfast, goal, 0),
    lunch: pickRecipe("lunch", t.cal * dist.lunch, goal, 1),
    dinner: pickRecipe("dinner", t.cal * dist.dinner, goal, 2),
    snack: pickRecipe("snack", t.cal * dist.snack, goal, 3)
  };
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
  document.getElementById("nutri-total-cal").textContent = tc;
  document.getElementById("nutri-total-sub").textContent =
    `Б:${tp}г · Ж:${tf}г · У:${tch}г · норма ${state.norm.cal} ккал`;
}

function pickRecipe(meal, target, goal, slot) {
  const pool = RECIPES.filter(r => r.meal === meal);
  if (!pool.length) return null;
  const sc = pool.map(r => {
    let s = Math.abs(r.cal - target);
    if (goal === "lose") s -= r.p * 2;
    if (goal === "gain") s -= r.cal * 0.1;
    return { r, s };
  });
  sc.sort((a, b) => a.s - b.s);
  const top = sc.slice(0, Math.min(3, sc.length));
  return top[(state.planSeed + slot) % top.length].r;
}

/* ============================================================
   7. РЕЦЕПТЫ
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
  document.getElementById("recipe-list").innerHTML = filtered.map(r => `
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
   8. ТРЕНИРОВКИ
   ============================================================ */
function renderWorkout() {
  if (!state.user) return;
  const plan = WORKOUT_PLANS[state.user.goal];
  document.getElementById("workout-sub").textContent = plan.title + " · авто";
  const list = document.getElementById("workout-list");
  list.innerHTML = "";
  plan.days.forEach((d, i) => {
    const card = document.createElement("div");
    card.className = "card";
    const isRest = d.type === "Отдых";
    const isDone = state.workoutLog[`${new Date().toISOString().slice(0, 10)}_${i}`];
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:${d.ex.length ? "12px" : "0"}">
        <div class="icon" style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;background:${isRest ? "rgba(255,169,77,.15)" : "rgba(108,92,231,.15)"}">
          ${isRest ? "😴" : d.type.includes("Бег") ? "🏃" : "💪"}
        </div>
        <div style="flex:1"><div style="font-weight:700">${d.day}</div>
        <div style="font-size:12px;color:var(--text-dim)">${d.type} · ${d.note}</div></div>
        ${!isRest ? `<button class="btn small ${isDone ? "secondary" : ""}" onclick="markWorkout(${i})">${isDone ? "✓" : "Готово"}</button>` : ""}
      </div>
      ${d.ex.map(exId => {
        const ex = EXERCISES.find(e => e.id === exId);
        if (!ex) return "";
        return `<div class="list-item" onclick="openExercise('${ex.id}')" style="cursor:pointer">
          <div class="icon">${ex.icon}</div>
          <div class="info"><div class="title">${ex.name}</div><div class="sub">${ex.reps} · ${ex.muscle}</div></div>
        </div>`;
      }).join("")}`;
    list.appendChild(card);
  });
}

window.markWorkout = function (idx) {
  const t = new Date().toISOString().slice(0, 10);
  const k = `${t}_${idx}`;
  state.workoutLog[k] = !state.workoutLog[k];
  saveLocal();
  renderWorkout();
  if (state.workoutLog[k]) toast("Выполнено! 💪", "ok");
  const u = getCurrentUser();
  if (u) saveWorkoutLogToCloud(u.uid, state.workoutLog);
};

/* Таймер планки */
let timerInt = null, timerSec = 0, timerRun = false;
window.toggleTimer = function () {
  const b = document.getElementById("timer-start");
  if (timerRun) {
    clearInterval(timerInt); timerRun = false; b.textContent = "▶ Продолжить";
  } else {
    timerRun = true; b.textContent = "⏸ Пауза";
    timerInt = setInterval(() => { timerSec++; updTimer(); }, 1000);
  }
};
window.resetTimer = function () {
  clearInterval(timerInt); timerRun = false; timerSec = 0;
  updTimer();
  document.getElementById("timer-start").textContent = "▶ Старт";
};
function updTimer() {
  const m = String(Math.floor(timerSec / 60)).padStart(2, "0");
  const s = String(timerSec % 60).padStart(2, "0");
  const d = document.getElementById("timer-display");
  if (d) d.textContent = `${m}:${s}`;
}

/* ============================================================
   9. УПРАЖНЕНИЯ
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
  document.getElementById("exercise-list").innerHTML = filtered.map(e => `
    <div class="card" style="cursor:pointer" onclick="openExercise('${e.id}')">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:32px">${e.icon}</div>
        <div style="flex:1"><div style="font-weight:700">${e.name}</div>
        <div style="font-size:12px;color:var(--text-dim)">${e.muscle} · ${e.reps}</div></div>
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
        <div class="macro"><div class="val" style="font-size:16px">${e.reps}</div><div class="name">Подходы/повторы</div></div>
        <div class="macro"><div class="val" style="font-size:16px">${e.place === "home" ? "Дом" : e.place === "street" ? "Улица" : e.place === "gym" ? "Зал" : "Везде"}</div><div class="name">Место</div></div>
      </div>
    </div>
    <div class="card"><h2>📝 Как выполнять</h2><p style="font-size:15px;line-height:1.7">${e.desc}</p></div>`;
  showScreen("recipe");
};

/* ============================================================
   10. ЗАМЕРЫ
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
  saveLocal();
  // Синхронизация
  const u = getCurrentUser();
  if (u) {
    await saveMeasurementToCloud(u.uid, m);
    await saveProfileToCloud(u.uid, state.user);
  }
  ["m-weight", "m-chest", "m-waist", "m-hips", "m-arm"].forEach(id => document.getElementById(id).value = "");
  renderMeasurements();
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
   11. ПОИСК ПРОДУКТОВ
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
  liveSearch();
};

window.liveSearch = function () {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  let found = PRODUCTS;
  if (state.searchCat !== "all") found = found.filter(p => p.cat === state.searchCat);
  if (q.length >= 1) found = found.filter(p => p.name.toLowerCase().includes(q));
  if (q.length < 1 && state.searchCat === "all") {
    document.getElementById("search-result").innerHTML = "";
    return;
  }
  found = found.slice(0, 30);
  if (found.length) renderSearchResults(found, q || state.searchCat);
  else renderSearchResults([], q);
};

window.searchProduct = function () {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  if (!q) return toast("Введи название", "bad");
  let found = PRODUCTS;
  if (state.searchCat !== "all") found = found.filter(p => p.cat === state.searchCat);
  found = found.filter(p => p.name.toLowerCase().includes(q));
  renderSearchResults(found, q);
};

function renderSearchResults(results, query) {
  const box = document.getElementById("search-result");
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
    img.src = ev.target.result;
    img.classList.remove("hidden");
    document.getElementById("photo-result").classList.remove("hidden");
    analyzePhoto();
    toast("Фото загружено! 📷", "ok");
  };
  r.readAsDataURL(f);
};

window.analyzePhoto = function () {
  const n = document.getElementById("photo-product-select").value;
  const p = PRODUCTS.find(x => x.name === n);
  if (!p) return;
  const v = getVerdict(p);
  document.getElementById("photo-verdict").innerHTML = `
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
  const q = document.getElementById("search-input").value.trim();
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
   12. КОНСТРУКТОР БЛЮД
   ============================================================ */
function renderMealBuilder() {
  renderBuilderItems();
  updateBuilderTotals();
}

window.addIngredientToMeal = function () {
  const sel = document.getElementById("mb-product-select");
  const grams = +document.getElementById("mb-grams").value || 100;
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
  document.getElementById("mb-grams").value = 100;
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
  const name = document.getElementById("mb-name").value.trim();
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
  // Сброс формы
  state.currentMealItems = [];
  document.getElementById("mb-name").value = "";
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
   13. ПРОФИЛЬ
   ============================================================ */
function renderProfile() {
  if (!state.user) return;
  const u = state.user;
  const gT = { lose: "Похудеть", gain: "Набрать массу", keep: "Поддерживать" }[u.goal];
  const sT = u.sex === "m" ? "Мужской" : "Женский";
  const pT = { home: "Дома", street: "На улице", gym: "В зале", any: "Везде" }[u.place || "any"];
  const email = state.fbUser?.email || "—";
  document.getElementById("profile-info").innerHTML = `
    <div class="list-item"><div class="icon">👤</div><div class="info"><div class="title">${u.name}</div><div class="sub">${sT}, ${u.age} лет</div></div></div>
    <div class="list-item"><div class="icon">📧</div><div class="info"><div class="title">${email}</div><div class="sub">Email</div></div></div>
    <div class="list-item"><div class="icon">📏</div><div class="info"><div class="title">${u.height} см · ${u.weight} кг</div><div class="sub">Рост и вес</div></div></div>
    <div class="list-item"><div class="icon">🎯</div><div class="info"><div class="title">${gT}</div><div class="sub">Цель</div></div></div>
    <div class="list-item"><div class="icon">🏋️</div><div class="info"><div class="title">${pT}</div><div class="sub">Место тренировок</div></div></div>
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
   14. АУТЕНТИФИКАЦИЯ — UI
   ============================================================ */
window.showAuth = function (mode) {
  document.getElementById("auth-login").classList.toggle("hidden", mode !== "login");
  document.getElementById("auth-register").classList.toggle("hidden", mode !== "register");
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
  toast("Добро пожаловать! 👋", "ok");
};

window.doLogout = async function () {
  if (!confirm("Выйти из аккаунта?")) return;
  await logoutUser();
  toast("Вы вышли 👋");
};

/* ============================================================
   15. ЗАГРУЗКА ПОСЛЕ ВХОДА
   ============================================================ */
async function afterLogin(fbUser) {
  state.fbUser = fbUser;
  const sync = await syncAllFromCloud(fbUser.uid);
  if (sync.profile) {
    state.user = sync.profile;
    state.norm = calcNorm(state.user);
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
    // Нет профиля — на онбординг
    document.getElementById("screen-onboarding").classList.add("active");
  }
}

function showAuthScreen() {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-auth").classList.add("active");
  document.getElementById("nav").classList.add("hidden");
}

/* ============================================================
   16. PWA УСТАНОВКА
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
      alert("📲 Установка на iPhone/iPad:\n\n1. Нажми кнопку «Поделиться» (квадрат со стрелкой) в Safari\n2. Пролистай и выбери «На экран Домой»\n3. Нажми «Добавить»\n\nГотово!");
    } else {
      alert("📲 Установка приложения:\n\n1. Открой меню браузера (⋮)\n2. Выбери «Установить приложение» или «Добавить на главный экран»\n3. Подтверди");
    }
  }
};

window.dismissInstall = function () {
  document.getElementById("install-banner")?.classList.remove("show");
  localStorage.setItem("fitlife_install_dismissed", "1");
};

/* ============================================================
   17. ИНИЦИАЛИЗАЦИЯ
   ============================================================ */
function init() {
  loadLocal();
  applyTheme();

  // Автотема
  if (!localStorage.getItem("fitlife_state")) {
    const d = window.matchMedia("(prefers-color-scheme: dark)").matches;
    state.theme = d ? "dark" : "light";
    applyTheme();
  }

  // Заполнение селекта продуктов в конструкторе
  const mbSel = document.getElementById("mb-product-select");
  if (mbSel) {
    mbSel.innerHTML = PRODUCTS.map(p => `<option value="${p.name}">${p.name}</option>`).join("");
  }

  // Подписка на Firebase Auth
  onAuthChange(user => {
    if (user) {
      afterLogin(user);
    } else {
      state.fbUser = null;
      if (state.user) {
        // Есть локальный профиль, но нет облака — работаем офлайн
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
  if (si) si.addEventListener("keydown", e => { if (e.key === "Enter") searchProduct(); });
}

/* ============================================================
   18. ЭКСПОРТ
   ============================================================ */
window.showScreen = showScreen;
window.toast = toast;

document.addEventListener("DOMContentLoaded", init);

console.log("✅ app.js загружен");