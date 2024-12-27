import { Stack } from 'expo-router';
import { AlarmProvider } from '../context/AlarmContext';

export default function RootLayout() {
  return (
    <AlarmProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </AlarmProvider>
  );
} 