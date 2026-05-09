import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, updateProfile,
  setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBIGG6KiETVGWMe66D7WmJcgJYM2gAztaM",
  authDomain: "gardenai-87d09.firebaseapp.com",
  projectId: "gardenai-87d09",
  storageBucket: "gardenai-87d09.firebasestorage.app",
  messagingSenderId: "553433041596",
  appId: "1:553433041596:web:0ff6d43a42cec4cd0f1eb9"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestoreDb = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Force local persistence so sessions survive iOS PWA restarts
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Detect iOS PWA standalone mode — signInWithPopup doesn't survive the
// popup flow in WKWebView/standalone, so we use redirect instead.
function isIOSPWA() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    (window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches)
  );
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  if (isIOSPWA()) {
    await signInWithRedirect(auth, provider);
    // onAuthStateChanged will fire after the redirect completes on next load
  } else {
    return signInWithPopup(auth, provider);
  }
}

// Call this once on startup to complete a pending redirect sign-in
export async function handlePendingRedirect() {
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch(e) {
    console.error('Redirect result error:', e);
    return null;
  }
}

export const logout = () => signOut(auth);
export const onAuthChange = (cb) => onAuthStateChanged(auth, cb);

export async function registerWithEmail(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) await updateProfile(cred.user, { displayName: name });
  return cred.user;
}

export const loginWithEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

export const resendVerification = () =>
  sendEmailVerification(auth.currentUser, {
    url: 'https://7ire.com/gardenai/',
    handleCodeInApp: false
  });

export const resetPassword = (email) =>
  sendPasswordResetEmail(auth, email, { url: 'https://7ire.com/gardenai/' });

export const reloadUser = () => auth.currentUser?.reload();

export function authErrorMessage(code) {
  const msgs = {
    'auth/email-already-in-use': 'Este email ya tiene una cuenta registrada.',
    'auth/wrong-password':       'Contraseña incorrecta.',
    'auth/user-not-found':       'No existe cuenta con ese email.',
    'auth/invalid-credential':   'Email o contraseña incorrectos.',
    'auth/weak-password':        'La contraseña debe tener al menos 6 caracteres.',
    'auth/invalid-email':        'El formato del email no es válido.',
    'auth/too-many-requests':    'Demasiados intentos. Espera unos minutos.',
    'auth/network-request-failed': 'Error de conexión. Verifica tu internet.'
  };
  return msgs[code] || 'Error al autenticar. Intenta de nuevo.';
}
