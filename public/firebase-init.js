// Firebase shared module — imported by login.html and chat.html
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            'AIzaSyAnV1R_PJReMfpH3FB-aaxe_ruXC20zoZo',
  authDomain:        'ai-college-navigator.firebaseapp.com',
  projectId:         'ai-college-navigator',
  storageBucket:     'ai-college-navigator.firebasestorage.app',
  messagingSenderId: '14373200695',
  appId:             '1:14373200695:web:8fc135e5c772ca1c8870b2',
  measurementId:     'G-MJEB014TD6',
};

const app            = initializeApp(firebaseConfig);
const auth           = getAuth(app);
const db             = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export {
  auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, orderBy, serverTimestamp,
};
