/**
 * Google Sign-In that works in both the web app and the Capacitor Android APK.
 *
 * - Web: Firebase JS `signInWithPopup`
 * - Native: `@capacitor-firebase/authentication` Google flow → `signInWithCredential`
 *   so Firestore / Auth state stay on the Firebase JS SDK used by the rest of Kora.
 */

import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
  type UserCredential,
} from "firebase/auth";
import { isNativeApp } from "./capacitorNative";

export async function signInWithGoogle(auth: Auth): Promise<UserCredential> {
  if (!isNativeApp()) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider);
  }

  // Native Android/iOS: get a Google ID token via the system account picker /
  // Credential Manager, then hydrate the Firebase JS Auth session.
  const result = await FirebaseAuthentication.signInWithGoogle({
    // Keep JS SDK as the source of truth for Auth + Firestore.
    skipNativeAuth: true,
  });

  const idToken = result.credential?.idToken;
  if (!idToken) {
    throw new Error("Google Sign-In did not return an ID token.");
  }

  const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
  return signInWithCredential(auth, credential);
}

/** Sign out of Firebase JS Auth and clear any native Google session. */
export async function signOutGoogle(auth: Auth | null | undefined): Promise<void> {
  if (isNativeApp()) {
    try {
      await FirebaseAuthentication.signOut();
    } catch (err) {
      console.warn("[Kora/Auth] Native Google sign-out skipped:", err);
    }
  }
  if (auth) {
    await firebaseSignOut(auth);
  }
}
