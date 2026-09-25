/* ============================================================
   FitLife — Firebase модуль (v2.0 — mobile fix)
   Файл: firebase.js
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence
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

// Держим сессию после закрытия браузера
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.warn("setPersistence:", err);
});

/* ============================================================
   2. АУТЕНТИФИКАЦИЯ
   ============================================================ */

export async function registerUser(email, password, name) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
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

export async function loginUser(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { ok: true, user: cred.user };
  } catch (err) {
    return { ok: false, error: translateError(err.code) };
  }
}

/**
 * Вход через Google.
 * На телефоне используется signInWithRedirect (надёжнее),
 * на десктопе — signInWithPopup (быстрее).
 */
export async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    // Определяем мобильное устройство
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (isMobile) {
      // Мобильное — редирект (уходит на google.com, возвращается обратно)
      await signInWithRedirect(auth, provider);
      return { ok: true, redirect: true };
    } else {
      // Десктоп — попап
      const cred = await signInWithPopup(auth, provider);
      await ensureUserDoc(cred.user);
      return { ok: true, user: cred.user };
    }
  } catch (err) {
    return { ok: false, error: translateError(err.code) };
  }
}

/**
 * Проверка результата после редиректа с Google.
 * Вызывать при загрузке страницы.
 */
export async function checkRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      await ensureUserDoc(result.user);
      return { ok: true, user: result.user };
    }
    return { ok: true, user: null };
  } catch (err) {
    console.warn("getRedirectResult error:", err);
    return { ok: false, error: translateError(err.code) };
  }
}

/**
 * Создать документ пользователя, если его нет.
 */
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || "Друг",
      email: user.email || "",
      createdAt: serverTimestamp(),
      profile: null
    });
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser;
}

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
    "auth/operation-not-allowed": "Способ входа отключён в Firebase Console",
    "auth/unauthorized-domain": "Домен не авторизован в Firebase (добавь его в Console)",
    "auth/redirect-cancelled-by-user": "Вход отменён"
  };
  return map[code] || `Ошибка: ${code}`;
}

/* ============================================================
   3. СИНХРОНИЗАЦИЯ
   ============================================================ */

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

export async function loadProfileFromCloud(userId) {
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (snap.exists()) return { ok: true, data: snap.data() };
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function saveMeasurementToCloud(userId, measurement) {
  try {
    const colRef = collection(db, "users", userId, "measurements");
    await addDoc(colRef, { ...measurement, createdAt: serverTimestamp() });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function loadMeasurementsFromCloud(userId) {
  try {
    const colRef = collection(db, "users", userId, "measurements");
    const q = query(colRef, orderBy("date", "asc"));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return { ok: true, data: list };
  } catch (err) {
    return { ok: false, error: err.message, data: [] };
  }
}

export async function deleteMeasurementFromCloud(userId, measurementId) {
  try {
    await deleteDoc(doc(db, "users", userId, "measurements", measurementId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function saveCustomMealToCloud(userId, meal) {
  try {
    const colRef = collection(db, "users", userId, "customMeals");
    const ref = await addDoc(colRef, { ...meal, createdAt: serverTimestamp() });
    return { ok: true, id: ref.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function loadCustomMealsFromCloud(userId) {
  try {
    const colRef = collection(db, "users", userId, "customMeals");
    const snap = await getDocs(colRef);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    return { ok: true, data: list };
  } catch (err) {
    return { ok: false, error: err.message, data: [] };
  }
}

export async function deleteCustomMealFromCloud(userId, mealId) {
  try {
    await deleteDoc(doc(db, "users", userId, "customMeals", mealId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

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

export { auth, db };

console.log("🔥 firebase.js (mobile) загружен");
