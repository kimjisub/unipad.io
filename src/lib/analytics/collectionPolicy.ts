const OPT_OUT_PARAMETER = 'no_analytics';
const OPT_OUT_SESSION_KEY = 'unipad:analytics-disabled';

type AnalyticsWindow = Window & typeof globalThis & {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: IArguments[];
};

/** Keep test events observable while preventing Google Analytics from transmitting them. */
export function prepareAnalyticsCollection(page: Window & typeof globalThis, measurementId?: string): void {
  const marked = new URL(page.location.href).searchParams.get(OPT_OUT_PARAMETER) === '1';
  let remembered = false;
  try {
    if (marked) page.sessionStorage.setItem(OPT_OUT_SESSION_KEY, '1');
    remembered = page.sessionStorage.getItem(OPT_OUT_SESSION_KEY) === '1';
  } catch {
    // A denied storage API must not prevent opting out on the current page.
  }
  if (!page.navigator.webdriver && !marked && !remembered) return;

  const disable = (id: string) => { Reflect.set(page, `ga-disable-${id}`, true); };
  if (measurementId) disable(measurementId);

  const analyticsPage = page as AnalyticsWindow;
  const previousGtag = analyticsPage.gtag;
  analyticsPage.dataLayer ??= [];
  // Firebase adopts this core function before fetching its measurement ID. Disable
  // that actual ID before its first config command can trigger an automatic page view.
  analyticsPage.gtag = function (...args: unknown[]) {
    if (args[0] === 'config' && typeof args[1] === 'string') disable(args[1]);
    if (previousGtag) previousGtag.apply(page, args);
    else {
      // gtag requires an Arguments object rather than the rest-parameter array.
      // eslint-disable-next-line prefer-rest-params
      analyticsPage.dataLayer!.push(arguments);
    }
  };
}
