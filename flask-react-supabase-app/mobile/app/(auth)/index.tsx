import { Redirect } from 'expo-router';
// Opening the (auth) modal lands on Login.
export default function AuthIndex() {
  return <Redirect href="/Login" />;
}
