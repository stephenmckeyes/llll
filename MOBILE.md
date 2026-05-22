# Mission on your phone

Until Mission is deployed to a public URL (e.g. Vercel), your phone
has to reach the dev server running on your PC. That requires three
things: the server bound to your network, the phone on the same WiFi,
and Windows Firewall allowing the connection.

This doc is the full step-by-step. If it doesn't work, scroll to the
troubleshooting section at the bottom.

---

## One-time setup

### 1. Find your PC's local IP address

Open PowerShell on the PC and run:

```
ipconfig
```

Scroll up until you see the section for your active WiFi adapter (the
header reads `Wireless LAN adapter Wi-Fi` or similar). Look for this
line:

```
IPv4 Address. . . . . . . . . . . : 192.168.X.X
```

That's your PC's local IP. **Write it down** — examples below assume
`192.168.1.42`; substitute yours.

> If the WiFi adapter section says "Media disconnected," your PC isn't
> on WiFi at all. Connect to WiFi first.

### 2. Make sure your phone is on the same WiFi network

Open your phone's WiFi settings. Whatever network your PC is on,
join the same one on the phone. Phones on a different network (or
on cellular data) can't reach your PC.

### 3. Allow Node.js through Windows Firewall (one-time)

The first time you run the dev server bound to your network, Windows
will pop up a "Windows Security Alert" dialog asking if you want to
allow Node.js to communicate. **Check "Private networks"** and click
**Allow access**.

If you accidentally clicked Cancel:
- Open **Windows Security** (Start menu → "Windows Security").
- Click **Firewall & network protection** → **Allow an app through firewall**.
- Click **Change settings** (top right), then **Allow another app...**
- Browse to your Node.js install (typically `C:\Program Files\nodejs\node.exe`).
- Make sure **Private** is checked. Click OK.

---

## Every-time setup

### 1. Start the dev server in network mode

In your project terminal:

```
npm run dev:phone
```

Note the `:phone` — that's a different script than the usual `npm run
dev`. This one binds the server to all network interfaces (not just
localhost), which is what makes it reachable from your phone.

Expected output:

```
- Local:        http://localhost:3000
- Network:      http://192.168.1.42:3000

✓ Ready in 2.1s
```

The "Network" line is the URL your phone will use.

### 2. Open the URL on your phone

In your phone's browser (Safari on iPhone, Chrome on Android), type:

```
http://192.168.1.42:3000
```

(replace with the IP from `ipconfig`). Mission should load.

If you want to keep using it, **Add to Home Screen**:

- **iPhone Safari**: tap the Share button → **Add to Home Screen**.
- **Android Chrome**: tap the three-dot menu → **Add to Home screen**.

That gives you an icon that opens Mission like a native app (still
backed by the dev server on your PC, so the PC has to be on).

### 3. Sign in once

Your phone is a separate browser — its cookies don't sync with the
PC. The first time you load Mission on the phone, you'll have to sign
in with the same email/password you use on the PC.

After signing in once, the phone stays signed in across reboots (as
long as you don't clear browser cookies).

---

## Troubleshooting

**"Network: http://192.168.1.42:3000" doesn't appear in `npm run dev:phone` output.**

You're probably running an old `dev` script. Make sure you typed
`npm run dev:phone` (with the colon). If the script doesn't exist,
your `package.json` is out of date — `git pull` and try again.

**Phone shows "Can't connect to server" or hangs forever.**

In this order:
1. Confirm phone is on **the same WiFi** as the PC. Cellular data
   doesn't work. Guest networks often don't either (they isolate
   devices from each other).
2. From the PC's browser, try opening `http://192.168.1.42:3000`
   (using the IP, not localhost). If the PC itself can't reach the
   network IP, the dev server isn't bound correctly — restart with
   `npm run dev:phone`.
3. Windows Firewall is probably blocking. Re-open Windows Security
   → Firewall → Allow an app through firewall, and verify Node.js
   is checked for Private networks.
4. Your router might be using "AP isolation" (a setting that blocks
   devices on the same WiFi from talking to each other). Check the
   router's admin page; disable AP/client isolation.

**Phone says "Not Secure" or warns about HTTP.**

That's normal — the dev server speaks HTTP, not HTTPS. Tap through
the warning. (When we deploy to Vercel, you'll get a proper HTTPS URL
that doesn't warn.)

**Your IP changed (yesterday it was .42, today it's .43).**

Routers assign IPs dynamically. If your PC's IP changed, you need to
use the new one on the phone. Re-run `ipconfig` to check. To pin the
PC to a specific IP permanently, set a **DHCP reservation** in the
router's admin page, but that's optional.

**Everything looks normal but the phone can't reach the PC.**

Some antivirus suites (Norton, McAfee, etc.) install their own
firewall on top of Windows Firewall. Check yours and grant Node.js
access there too.

---

## The "real" fix: deploy to Vercel

When you're ready to use Mission daily, deploying to Vercel makes the
phone access permanent and removes the "PC has to be on" requirement.
The free tier is enough for personal use. That's a separate session
(needs Supabase environment variables set up in Vercel's dashboard +
making sure `proxy.ts` works on Vercel's edge runtime); flag it when
you want to do it.
