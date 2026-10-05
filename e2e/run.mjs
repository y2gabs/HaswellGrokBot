import { chromium } from "playwright-core";
import { execSync } from "node:child_process";

const SHOTS = process.env.SHOTS ?? "shots";
const WORK = process.env.WORK;
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const wp = (code) =>
  execSync(`php ${WORK}/wp-cli.phar --allow-root --path=${WORK}/wp eval '${code}' --url=http://localhost/acme/`, { encoding: "utf8" }).trim();

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
const step = (s) => console.log("•", s);

// Welcome → in-app sign-in → home.
await page.goto("http://localhost:3000/");
await page.screenshot({ path: `${SHOTS}/1-welcome.png` });
// In-app sign-in: a wrong password first, then the right one.
await page.fill('input[name="username"]', "editor1");
await page.fill('input[name="password"]', "wrong-password");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForSelector("text=Incorrect username or password.");
step("wrong password rejected in-app");
await page.screenshot({ path: `${SHOTS}/2-login-error.png` });
await page.fill('input[name="password"]', "pass1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("http://localhost:3000/home");
await page.waitForSelector("text=Your team");
step("signed in, home shows: " + (await page.locator("header a").first().innerText()));
await page.screenshot({ path: `${SHOTS}/3-home.png` });

// Website Manager: change the long tagline, approve.
await page.getByRole("button", { name: /Website Manager/ }).click();
await page.waitForURL(/\/chat\/\d+/);
await page.waitForSelector("text=What would you like to change?");
await page.fill("textarea", "Change our long tagline to Plumbing done right, first time");
await page.keyboard.press("Enter");
await page.waitForSelector("text=Needs your OK", { timeout: 20000 });
await page.screenshot({ path: `${SHOTS}/4-approval.png` });
step("approval card shown; tagline still: " + wp('echo get_field("long_tagline",3);'));
await page.getByRole("button", { name: "Approve" }).click();
await page.waitForSelector("text=Done — your long tagline is updated.", { timeout: 20000 });
await page.screenshot({ path: `${SHOTS}/5-approved.png` });
step("after approve, tagline: " + wp('echo get_field("long_tagline",3);'));

// Marketing: three ideas → pick → article → image → approve → published.
await page.goto("http://localhost:3000/home");
await page.getByRole("button", { name: /Marketing/ }).click();
await page.waitForURL(/\/chat\/\d+/);
await page.waitForSelector("text=Protect your pipes this winter", { timeout: 20000 });
await page.screenshot({ path: `${SHOTS}/6-ideas.png` });
step("three ideas offered");
await page.getByRole("button", { name: /Protect your pipes this winter/ }).click();
await page.waitForSelector("text=Pick a featured image", { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/7-article-images.png`, fullPage: true });
step("article drafted and images offered");
await page.getByRole("button", { name: "Option 2" }).click();
await page.waitForSelector("text=Post announcement to your website", { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/8-publish-approval.png`, fullPage: true });
step("announcements before approve: " + wp('echo count(get_posts(["post_type"=>"announcements","post_status"=>"publish"]));'));
await page.getByRole("button", { name: "Approve" }).click();
await page.waitForSelector("text=Published!", { timeout: 20000 });
await page.screenshot({ path: `${SHOTS}/9-published.png`, fullPage: true });
step(
  "published: " +
    wp(
      '$p=get_posts(["post_type"=>"announcements","numberposts"=>1]); $p=$p[0]; echo $p->post_title." | thumb=".get_post_thumbnail_id($p->ID)." | img=".get_field("announcement_featured_image",$p->ID,false)." | body=".substr(get_field("announcement_body",$p->ID,false),0,40);',
    ),
);

// Home shows both threads.
await page.goto("http://localhost:3000/home");
await page.waitForSelector("text=Recent");
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/10-home-recent.png` });
step("recent: " + (await page.locator("ul li").allInnerTexts()).map((t) => t.split("\n")[0]).join(" / "));

// Sign out revokes the app password.
await page.getByRole("button", { name: "Account" }).click();
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL("http://localhost:3000/");
step("signed out; app passwords left: " + wp('echo count(WP_Application_Passwords::get_user_application_passwords(2));'));

await browser.close();
