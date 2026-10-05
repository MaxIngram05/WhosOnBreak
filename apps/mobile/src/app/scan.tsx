/**
 * Scans a friend's QR code and sends them a request. Also understands group
 * join codes, so pointing it at a group's QR does the obvious thing.
 */

import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Muted, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { codeFromScan } from '@/lib/time';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // The scanner fires repeatedly while the code is in view; act on it once.
  const handled = useRef(false);

  if (!permission) return <Screen><Muted>Checking camera permission…</Muted></Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <ThemedText style={{ marginBottom: Spacing.three }}>
          The camera is only used to read friend QR codes.
        </ThemedText>
        <Button title="Allow camera" onPress={requestPermission} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const group = /join\/([A-Za-z0-9]{6})/.exec(data);
          if (group?.[1]) {
            handled.current = true;
            router.replace(`/join/${group[1].toUpperCase()}`);
            return;
          }
          const code = codeFromScan(data);
          if (!code) {
            setError("That QR code isn't a WhosOnBreak friend code.");
            return;
          }
          handled.current = true;
          router.replace(`/friend/${code}`);
        }}
      />
      <View style={styles.hint}>
        <ThemedText style={{ color: '#fff', textAlign: 'center' }}>
          Point at a friend&apos;s QR code
        </ThemedText>
        <ErrorText>{error}</ErrorText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    bottom: Spacing.six,
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
