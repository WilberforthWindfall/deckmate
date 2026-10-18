import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

// Web config of the Firebase project "deckmate-a9165". These values are public by design;
// access is controlled by Firebase Authentication and the rules in firestore.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyBD0RjmjEWRUikrr1nxHTlOo13AYpWfbbw',
  authDomain: 'deckmate-a9165.firebaseapp.com',
  projectId: 'deckmate-a9165',
  storageBucket: 'deckmate-a9165.appspot.com',
  messagingSenderId: '410785112741',
  appId: '1:410785112741:web:42b314859fa03454b4634c',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
