// Import the functions you need from the SDKs you need
import {initializeApp} from "firebase/app";
import {getFirestore, getDoc, collection, doc, query, orderBy, querySnapshot} from "firebase/firestore";
import {getAuth} from "firebase/auth";
import {getStorage} from "firebase/storage";
import {getFunctions} from "firebase/functions";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDaUEnCmD2eVv50aGk076RnghZzxvouAZ8",
  authDomain: "pakset-work.firebaseapp.com",
  projectId: "pakset-work",
  storageBucket: "pakset-work.firebasestorage.app",
  messagingSenderId: "176607128375",
  appId: "1:176607128375:web:70e4a64d2a41f13daf08b2",
  measurementId: "G-06VVRGDKKS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);c

export { getFirestore, getAuth, getStorage, getFunctions };