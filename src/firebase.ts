import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

// Web config of the Firebase project "deckmate-633e4". These values are public by design;
// access is controlled by Firebase Authentication and the rules in firestore.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyDJkGnBVHjvXCW6kq1NWqYfwvzFV6pkxz0',
  authDomain: 'deckmate-633e4.firebaseapp.com',
  projectId: 'deckmate-633e4',
  storageBucket: 'deckmate-633e4.firebasestorage.app',
  messagingSenderId: '614483223340',
  appId: '1:614483223340:web:c0c542024e2678dd1c0289',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
