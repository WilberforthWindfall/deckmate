import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue } from 'firebase/database';

// **Ersetze hier mit deinen Firebase-Daten!**
const firebaseConfig = {
  apiKey: 'AIzaSyBD0RjmjEWRUikrr1nxHTlOo13AYpWfbbw',
  authDomain: 'deckmate-a9165.firebaseapp.com',
  databaseURL:
    'https://deckmate-a9165-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'deckmate-a9165',
  storageBucket: 'deckmate-a9165.firebasestorage.app',
  messagingSenderId: '410785112741',
  appId: '1:410785112741:web:42b314859fa03454b4634c',
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export { database, ref, set, onValue };
