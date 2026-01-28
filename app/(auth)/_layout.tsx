import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: styles.header,
        headerTintColor: '#fff',
        headerTitleStyle: styles.headerTitle,
        contentStyle: styles.content,
      }}
    >
      <Stack.Screen
        name="sign-in"
        options={{
          title: 'Sign In',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="sign-up"
        options={{
          title: 'Sign Up',
          headerShown: false,
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#1a1a1a',
  },
  headerTitle: {
    fontWeight: '600',
  },
  content: {
    backgroundColor: '#1a1a1a',
  },
});
