# Room 26 website

The public site (news, album reviews, features, interviews, culture) plus a private **Admin** area, backed by **Supabase**:

- **Supabase Auth**: admins sign in with email and password. Invite-only; public sign-up is switched off.
- **Postgres**: posts, image library, team and site settings, protected by row-level security.
- **Storage**: a public `media` bucket for covers, album art and in-article photos. Only admins can upload.
- **Edge Function** `invite-admin`: sends the invite email and grants admin access. Only admins can call it.

It's a plain static site (`index.html`, `styles.css`, `app.js`, `config.js`, `logo.png`), so you can host it anywhere.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The site and the Admin area |
| `config.js` | Your Supabase URL and anon key (you fill this in) |
| `supabase/migrations/…_init.sql` | Tables, security rules, storage bucket |
| `supabase/seed.sql` | Optional example posts, all labelled "Example" |
| `supabase/functions/invite-admin/index.ts` | The invite Edge Function |
| `serve.ps1` | A tiny local server for testing on Windows |

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign in at supabase.com and create a new project. Note the database password.
2. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
3. Paste both into `config.js`. Never put the `service_role` key in this file.

### 2. Create the database
1. Open **SQL Editor → New query**.
2. Paste the whole of `supabase/migrations/20260929000000_init.sql` and click **Run**.
3. Optional: run `supabase/seed.sql` the same way to add example posts.

### 3. Lock down sign-ups and set your site address
In **Authentication → Sign In / Providers**:
- Turn **off** "Allow new users to sign up". Admins join by invite only.

In **Authentication → URL Configuration**:
- **Site URL**: your live address, e.g. `https://room26.example.com`
- **Redirect URLs**: add `https://room26.example.com/**` and, for local testing, `http://localhost:5526/**`

### 4. Deploy the invite function
With the Supabase CLI (`npm i -g supabase`, or see the Supabase docs for Windows installers):

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase secrets set SITE_URL=https://room26.example.com
supabase functions deploy invite-admin
```

Or, from the dashboard, go to **Edge Functions → Deploy a new function**, name it `invite-admin` and paste in `index.ts`. Then add the `SITE_URL` secret under **Edge Functions → Secrets**.

### 5. Make yourself the first admin
1. **Authentication → Users → Add user → Create new user**: enter your email and a password. Tick "Auto confirm user".
2. In the **SQL Editor**, run this with your email:

```sql
insert into public.admins (user_id, email, accepted_at)
select id, email, now() from auth.users where email = 'you@example.com';
```

### 6. Try it locally
```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```
Open http://localhost:5526, then go to **Admin sign-in** in the footer.

### 7. Put it online
Upload the folder (everything except `supabase/` and `serve.ps1`) to any static host: Netlify, Vercel, Cloudflare Pages or GitHub Pages. With Netlify you can drag the folder onto app.netlify.com/drop. Then point your domain at it and update the Site URL in step 3.

## Using Admin

- **Posts**: everything, published and drafts. Search, filter, edit, preview drafts, publish, unpublish, make lead story, delete.
- **Write**: headline, standfirst, author, section, body, cover image and tone. Album reviews add artist, album, label, year and a score out of 10.
  - Body formatting: blank line = new paragraph · `## ` = subheading · `> ` = pull quote · `[image 2026/abc.jpg Caption]` = photo with caption (the image buttons insert this for you).
- **Images**: drag-and-drop uploads, where each image is used, and safe delete.
- **Team**: invite an admin by email; they get a link, set a password and are in. You can remove other admins, but not yourself, so the site always keeps at least one.
- **Site settings**: announcement bar, tagline, top bar text and footer text.

## Email

Supabase's built-in email sender is rate-limited and meant for testing. For real invites and password resets, add your own SMTP provider under **Authentication → Emails → SMTP Settings** (Resend, Postmark and SendGrid all work). You can also restyle the Invite and Reset Password templates there.

## Security notes

- Visitors can only read **published** posts and settings. Drafts, the image library list, and the team list are admin-only, enforced in the database, not just hidden in the page.
- Uploads are limited to PNG, JPEG, WebP and GIF, up to 20 MB, and only admins can upload.
- The invite function checks that the caller is an admin before doing anything.
