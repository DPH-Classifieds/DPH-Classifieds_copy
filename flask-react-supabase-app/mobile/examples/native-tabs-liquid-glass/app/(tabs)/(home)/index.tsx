// Home tab content. It only renders a tall list inside GlassScrollScreen — the
// transparent header (this tab's stack) and the Liquid Glass tab bar do the rest,
// blurring these cards as they pass under the bars.
import { GlassScrollScreen } from '../../../components/GlassScrollScreen';
import { Card } from '../../../components/Card';

type Feature = { id: string; title: string; body: string };

const FEATURES: readonly Feature[] = [
  { id: 'glass', title: 'Liquid Glass tab bar', body: 'A genuine UITabBarController — iOS 26 applies the translucent material itself.' },
  { id: 'blur', title: 'Dynamic scroll blur', body: 'Content scrolls edge-to-edge behind the bars, so the system blur reacts live.' },
  { id: 'header', title: 'Transparent large title', body: 'headerTransparent + headerBlurEffect give the modern HIG navigation bar.' },
  { id: 'native', title: 'Native, not JS', body: 'No BlurView, no absolute tab bar — the OS owns the chrome and the motion.' },
  { id: 'insets', title: 'Automatic content insets', body: 'contentInsetAdjustmentBehavior lets iOS place content correctly under both bars.' },
  { id: 'minimize', title: 'Minimize on scroll', body: 'The bar collapses to a compact pill as you scroll down, like Apple’s own apps.' },
  { id: 'sf', title: 'SF Symbols', body: 'Triggers render real SF Symbols, sharpening and animating natively.' },
  { id: 'router', title: 'File-based routing', body: 'Each tab is a folder; each header is its own stack — fully modular.' },
];

export default function HomeScreen(): React.JSX.Element {
  return (
    <GlassScrollScreen>
      {FEATURES.map((f) => (
        <Card key={f.id} title={f.title} body={f.body} />
      ))}
    </GlassScrollScreen>
  );
}
