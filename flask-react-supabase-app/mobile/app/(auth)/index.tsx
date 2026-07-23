import { Redirect } from 'expo-router';
// Route groups (auth)/(tabs) both collide at "/", and (auth) can win group-sort
// on cold start — which used to force the Login screen on launch. Redirect the
// (auth) group index to Explore so opening the app always lands on the tabs.
// The Login/Signup screens are only ever reached via explicit router.push('/Login').
export default function AuthIndex() {
  return <Redirect href="/(tabs)/(explore)" />;
}
