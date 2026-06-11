# Going live — plain-English guide

You don't need to understand the code. This explains what each part is and the
exact clicks to get it online. There are only three accounts involved:

- **Supabase** — the private database that stores your logs.
- **Vercel** — puts the website online at a web address you can open on any device.
- **GitHub** — holds the code so Vercel can read it. (Optional if I deploy for you.)

---

## What I need from you to put it live

Once you've created the projects, send me:

1. Your **Supabase project** is created (I'll apply the database for you).
2. Your **Vercel** and **GitHub** accounts exist.

I'll handle the technical deployment through the secure connections. The steps
below are the full manual path too, in case you'd rather click through it
yourself or want to understand what's happening.

---

## Step 1 — Set up the database (Supabase)

1. In your Supabase project, open **SQL Editor** (left sidebar).
2. Open the file `supabase/schema.sql` from this project, copy everything.
3. Paste it into the SQL Editor and press **Run**.
4. You should see "Success". This creates all the tables and locks them so only
   you can ever see your own data.

Then make sign-in simple for a personal app:

5. Go to **Authentication → Providers → Email** and (for now) turn **off**
   "Confirm email". This lets you sign in immediately without clicking an email
   link. You can turn it back on later.

Finally, copy your two keys:

6. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key. You'll paste these into Vercel in Step 3.

---

## Step 2 — Put the code on GitHub

Easiest no-tools way:

1. On GitHub, click **New repository**, name it `health-tracker`, create it.
2. On the new repo page, click **uploading an existing file**.
3. Drag in all the files from this project (or the zip's contents).
4. Click **Commit changes**.

---

## Step 3 — Deploy on Vercel

1. On Vercel, click **Add New → Project**.
2. Choose the `health-tracker` GitHub repo you just created → **Import**.
3. Vercel auto-detects it as a Vite app — leave the build settings as they are.
4. Open **Environment Variables** and add these two (from Step 1):
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
5. Click **Deploy**. After a minute you'll get a live web address.

That address is your app. Open it on your phone and add it to your home screen.

---

## Step 4 — First run

1. Open the live address, click **Create an account**, use your email + a password.
2. Sign in.
3. Open **Settings**, set your name, height, GLP-1 medication, and your next
   Tuesday appointment date.
4. Start logging. Before each appointment, tap **Download weekly PDF** and send
   or print it for your doctor.

---

## Each week (your routine)

- Log meals, water, injections, activity, side effects as they happen (a few taps).
- Once a week: iPhone **Health app → your photo → Export All Health Data**,
  unzip it, and upload the `export.xml` in the **Apple Health** card.
- Tap **Download weekly PDF** before Tuesday.

---

## A note on your data

This stores real health information. The database is private to your account by
design. Before you ever turn this into a product for other people, we should add
formal consent, encryption of the most sensitive fields, and a proper privacy
policy — that's a planned step, not an afterthought.
