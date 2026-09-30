import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it } from 'vitest';

function browser(config, options = {}) {
  const requests = [], scripts = [];
  const context = {
    window: null, navigator: { globalPrivacyControl: options.gpc || false },
    localStorage: { getItem: () => options.optOut ? '1' : null },
    document: { cookie: '', visibilityState: 'visible', getElementById: () => null,
      createElement: () => ({}), head: { appendChild: s => scripts.push(s.src) },
      addEventListener: () => {}, removeEventListener: () => {} },
    fetch: (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); },
    pixiiTracking: config, AbortSignal, URL, URLSearchParams, setTimeout, clearTimeout
  };
  context.window = context;
  vm.runInNewContext(readFileSync(new URL('../public/assets/analytics-v1.js', import.meta.url),'utf8'),context);
  return { context, requests, scripts };
}

it('reports only first-party form visibility, never loads advertising on forms', () => {
  const { requests, scripts } = browser({ page:'form', context:'signed', pixels:{meta:'123'} });
  expect(requests).toEqual([{url:'/analytics/events', body:{context:'signed',event:'wifi_form_viewed',optOut:false}}]);
  expect(scripts).toEqual([]);
});

it('GPC and recorded opt-outs suppress advertising even if the server config enabled it', () => {
  for(const options of [{gpc:true},{optOut:true}]) {
    const {context,scripts,requests} = browser({page:'connected',context:'signed',pixels:{meta:'123',google:['G-ABC'],linkedin:'456',rb2b:'abc'}},options);
    context.pixiiTrackOpen('automatic');
    expect(scripts).toEqual([]);
    expect(context.pixiiTrackingSuppressed).toBe(true);
    expect(context.pixiiTrackingOptOut).toBe(true);
    expect(requests.at(-1).body.optOut).toBe(true);
  }
});

it('does not present server eligibility suppression as a permanent browser preference',()=>{
  const {context,scripts}=browser({page:'connected',context:'signed',suppressed:true,pixels:{meta:'123'}});
  expect(context.pixiiTrackingSuppressed).toBe(true);
  expect(context.pixiiTrackingOptOut).toBe(false);
  expect(scripts).toEqual([]);
});

it('loads enabled vendors only on the clean final page; requests never include the location or form', () => {
  const {context,scripts,requests} = browser({page:'connected',context:'signed',pixels:{meta:'123',google:['G-ABC'],linkedin:'456',rb2b:'abc'}});
  expect(scripts).toHaveLength(4);
  context.pixiiTrackOpen('click');
  expect(requests[0].body).toEqual({context:'signed',event:'wifi_pixii_open_requested',method:'click',optOut:false});
  expect(context.fbq.queue).toContainEqual(['trackCustom','WifiConnected']);
  expect(context.fbq.queue).toContainEqual(['set','autoConfig',false,'123']);
});
