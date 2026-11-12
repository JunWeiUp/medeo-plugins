// One bundle for both pages; the page says which one it is.
import { startOverlay } from '../src/ui/overlay.ts';
import { startSettings } from '../src/ui/settings.ts';
if (document.body.dataset.page === 'settings') void startSettings(); else void startOverlay();
