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
    // "no credential available" surfaces here when Android's Credential Manager
    // can't return a Google account/token — almost always because (a) no Google
    // account is signed in on the device, or (b) the APK's signing-cert SHA-1
    // isn't registered for this OAuth client in the Firebase console. Register
    // the release keystore SHA-1 there to fix it.
    throw new Error(
      "Google Sign-In returned no credential. Add a Google account on this device, and ensure the APK signing certificate's SHA-1 is registered for the OAuth client in the Firebase console."
    );
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
