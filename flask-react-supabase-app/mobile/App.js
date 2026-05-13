import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from './src/context/AuthContext';
import { SavedListingsProvider } from './src/context/SavedListingsContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SavedListingsProvider>
          <StatusBar style="light" />
          <AppNavigator />
        </SavedListingsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
