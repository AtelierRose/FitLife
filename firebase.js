/* ============================================================
   FitLife — Firebase модуль
   Версия: 1.0
   Файл: firebase.js
   
   ВАЖНО: этот файл работает ТОЛЬКО через https://
   (GitHub Pages, Netlify, Vercel). Через file:// не работает.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

/* ============================================================
   1. КОНФИГ
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyAWQYpwlr1ftIy2YKWVz7ndO5ka1n9w-xk",
  authDomain: "fitlife-2f9eb.firebaseapp.com",
  projectId: "fitlife-2f9eb",
  storageBucket: "fitlife-2f9eb.firebasestorage.app",
  messagingSenderId: "10590666256",
  appId: "1:10590666256:web:0aa16966b473ab3533d495"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ============================================================
   2. АУТЕНТИФИКАЦИЯ
   ============================================================ */

/**
 * Регистрация по Email + пароль
 * @param {string} email
 * @param {string} password
 * @param {string} name — имя пользователя
 * @returns {object} user
 */
export async function registerUser(email, password, name) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Сохраняем имя в профиле
    await updateProfile(cred.user, { displayName: name });
    // Создаём документ в Firestore
    await setDoc(doc(db, "users", cred.user.uid), {
      name: name || "Друг",
      email: email,
      createdAt: serverTimestamp(),
      profile: null
    });
    return { ok: true, user: cred.user };
  } catch (err) {
    return { ok: false, error: translateError(err.code) };
  }
}

/**
 * Вход по Email + паролю
 */
export async function loginUser(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { ok: true, user: cred.user };
  } catch (err) {
    return { ok: false, error: translateError(err.code) };
  }
}

/**
 * Вход через Google (одним кликом)
 */
export async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    // Создаём документ, если новый пользователь
    const userRef = doc(db, "users", cred.user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        name: cred.user.displayName || "Друг",
        email: cred.user.email,
        createdAt: serverTimestamp(),
        profile: null
      });
    }
    return { ok: true, user: cred.user };
  } catch (err) {
    return { ok: false, error: translateError(err.code) };
  }
}

/**
 * Выход
 */
export async function logoutUser() {
  try {
    await signOut(auth);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Подписка на изменения состояния входа
 * Вызывается при загрузке страницы и при входе/выходе
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Получить текущего пользователя
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Перевод ошибок Firebase на русский
 */
function translateError(code) {
  const map = {
    "auth/email-already-in-use": "Этот email уже зарегистрирован",
    "auth/invalid-email": "Неверный формат email",
    "auth/weak-password": "Пароль слишком простой (минимум 6 символов)",
    "auth/user-not-found": "Пользователь не найден",
    "auth/wrong-password": "Неверный пароль",
    "auth/invalid-credential": "Неверный email или пароль",
    "auth/too-many-requests": "Слишком много попыток. Попробуй позже",
    "auth/popup-closed-by-user": "Окно входа закрыто",
    "auth/network-request-failed": "Нет интернета",
    "auth/operation-not-allowed": "Способ входа отключён в Firebase Console"
  };
  return map[code] || `Ошибка: ${code}`;
}

/* ============================================================
   3. СИНХРОНИЗАЦИЯ ДАННЫХ
   ============================================================ */

/**
 * Сохранить профиль пользователя
 */
export async function saveProfileToCloud(userId, profile) {
  try {
    await setDoc(doc(db, "users", userId), {
      profile: profile,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { ok: true };
  } catch (err) {
    console.warn("saveProfileToCloud:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Загрузить профиль
 */
export async function loadProfileFromCloud(userId) {
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (snap.exists()) {
      return { ok: true, data: snap.data() };
    }
    return { ok: true, data: null };
  } catch (err) {
    console.warn("loadProfileFromCloud:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Сохранить замер
 */
export async function saveMeasurementToCloud(userId, measurement) {
  try {
    const colRef = collection(db, "users", userId, "measurements");
    await addDoc(colRef, {
      ...measurement,
      createdAt: serverTimestamp()
    });
    return { ok: true };
  } catch (err) {
    console.warn("saveMeasurementToCloud:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Загрузить все замеры
 */
export async function loadMeasurementsFromCloud(userId) {
  try {
    const colRef = collection(db, "users", userId, "measurements");
    const q = query(colRef, orderBy("date", "asc"));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return { ok: true, data: list };
  } catch (err) {
    console.warn("loadMeasurementsFromCloud:", err);
    return { ok: false, error: err.message, data: [] };
  }
}

/**
 * Удалить замер
 */
export async function deleteMeasurementFromCloud(userId, measurementId) {
  try {
    await deleteDoc(doc(db, "users", userId, "measurements", measurementId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Сохранить своё блюдо (из конструктора)
 */
export async function saveCustomMealToCloud(userId, meal) {
  try {
    const colRef = collection(db, "users", userId, "customMeals");
    const ref = await addDoc(colRef, {
      ...meal,
      createdAt: serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (err) {
    console.warn("saveCustomMealToCloud:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Загрузить все свои блюда
 */
export async function loadCustomMealsFromCloud(userId) {
  try {
    const colRef = collection(db, "users", userId, "customMeals");
    const snap = await getDocs(colRef);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return { ok: true, data: list };
  } catch (err) {
    console.warn("loadCustomMealsFromCloud:", err);
    return { ok: false, error: err.message, data: [] };
  }
}

/**
 * Удалить своё блюдо
 */
export async function deleteCustomMealFromCloud(userId, mealId) {
  try {
    await deleteDoc(doc(db, "users", userId, "customMeals", mealId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Сохранить лог тренировок
 */
export async function saveWorkoutLogToCloud(userId, log) {
  try {
    await setDoc(doc(db, "users", userId), {
      workoutLog: log,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Загрузить лог тренировок
 */
export async function loadWorkoutLogFromCloud(userId) {
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (snap.exists() && snap.data().workoutLog) {
      return { ok: true, data: snap.data().workoutLog };
    }
    return { ok: true, data: {} };
  } catch (err) {
    return { ok: false, error: err.message, data: {} };
  }
}

/* ============================================================
   4. ПОЛНАЯ СИНХРОНИЗАЦИЯ ПРИ ВХОДЕ
   ============================================================ */

/**
 * Загрузить ВСЁ из облака (профиль, замеры, блюда, лог)
 * Вызывается при входе пользователя
 */
export async function syncAllFromCloud(userId) {
  const [profile, measurements, customMeals, workoutLog] = await Promise.all([
    loadProfileFromCloud(userId),
    loadMeasurementsFromCloud(userId),
    loadCustomMealsFromCloud(userId),
    loadWorkoutLogFromCloud(userId)
  ]);

  return {
    ok: true,
    profile: profile.data?.profile || null,
    measurements: measurements.data || [],
    customMeals: customMeals.data || [],
    workoutLog: workoutLog.data || {}
  };
}

/* ============================================================
   5. ЭКСПОРТ
   ============================================================ */
export { auth, db };

console.log("🔥 firebase.js загружен");