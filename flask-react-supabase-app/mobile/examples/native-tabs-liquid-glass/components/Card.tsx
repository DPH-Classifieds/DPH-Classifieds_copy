// Presentational card used by the tab screens. Kept dumb + typed so the screens
// stay declarative.
import { StyleSheet, Text, View } from 'react-native';

type CardProps = {
  title: string;
  body: string;
};

export function Card({ title, body }: CardProps): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    padding: 16,
    gap: 6,
  },
  title: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  body: { color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 20 },
});
