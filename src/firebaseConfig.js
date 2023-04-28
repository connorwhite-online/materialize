import firebase, { initializeApp } from 'firebase/app';
import { getAnalytics, logEvent } from "firebase/analytics";
import 'firebase/auth';
import 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyB91NQItHsVsIpKqmJWsw_ytT9OYMYe_Dk",
  authDomain: "materialize-e9aa7.firebaseapp.com",
  projectId: "materialize-e9aa7",
  storageBucket: "materialize-e9aa7.appspot.com",
  messagingSenderId: "41806812830",
  appId: "1:41806812830:web:cb88101ae3799927308d8f",
  measurementId: "G-3CGD8M0644"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
logEvent(analytics, 'notification_received');

export const auth = firebase.auth();
export const storage = firebase.storage();