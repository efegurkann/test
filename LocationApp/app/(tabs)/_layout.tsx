import { Stack } from 'expo-router';

export default function TabLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="scheduled-alarms" />
      <Stack.Screen name="saved-locations" />
    </Stack>
  );
} 