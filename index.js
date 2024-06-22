import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as dotenv from "dotenv";
import { google } from "googleapis";
import { setTimeout } from "timers/promises";
import fs from "fs";

dotenv.config();
puppeteer.use(StealthPlugin());

// Pull credenetials
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const credential_path = "./credential.json";
const spreadSheet_ID = process.env.SPREADSHEET_ID;
const range_column = `${process.env.SHEET_NAME}!A:C`;
const loginUrl = "https://sales.bodynova.com/index.php";

// Function Authorize Google
async function authorize() {
  const content = fs.readFileSync(credential_path);
  const credentials = JSON.parse(content);

  const authClient = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return authClient.getClient();
}

// Function Read SpreadSheet
async function readSpreadsheet(auth) {
  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadSheet_ID,
    range: range_column,
  });

  const rows = response.data.values;
  if (rows.length) {
    return rows.slice(1).map((row) => ({
      code: row[0],
      amount: row[1],
      help: row[2],
    }));
  } else {
    throw new Error("No data found.");
  }
}

// Function logging reminder
function consoleLog(values) {
  console.log(`============== ${values} `);
}

// Function loginWebsite
async function loginPage(page, email, password, browser, loginUrl) {
  try {
    const existCookies = fs.existsSync("./cookies.json");
    if (!existCookies) {
      consoleLog("COOKIES NOT FOUND, LOGGING IN .....");
      // consoleLog("LOGGING IN ....");
      await page.goto(loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000, // reduce waiting login
      });

      await setTimeout(1000);

      await page.waitForSelector('input[type="email"]', { visible: true });
      await page.type('input[type="email"]', email, { delay: 200 });

      await page.waitForSelector('input[type="password"]', { visible: true });
      await page.type('input[type="password"]', password, { delay: 200 });

      await page.waitForSelector('button[type="submit"]', { visible: true });
      await page.click('button[type="submit"]');

      await setTimeout(2000); /// Reduce for better experience

      try {
        const loginFailed = await page.evaluate(() => {
          return document.body.textContent;
        });

        if (loginFailed.includes("Falsch passwort")) {
          consoleLog("CREDENTIAL ARE WRONG, PLEASE TRY AGAIN ...");
          await browser.close();

          return false;
        } else {
          const cookies = await page.cookies();
          fs.writeFileSync("./cookies.json", JSON.stringify(cookies, null, 2));
          consoleLog("LOGIN SUCESSFULLY, COOKIES SAVED ...");

          return true;
        }
      } catch (error) {
        console.error("An error occurred:", error);
      }
    } else {
      const cookieString = fs.readFileSync("./cookies.json");
      const cookies = await JSON.parse(cookieString);
      await page.setCookie(...cookies);
      consoleLog("COOKIES FOUND AND SETTED SUCCESSFULLY");

      return true;
    }
  } catch (error) {
    console.log(`login failed : `, error);
  }
}

// Function addToChart
async function addToChart(page, codeItem, amountItem, itemsVarian) {
  try {
    // Define match codeItem
    let foundMatch = false;
    for (let item of itemsVarian) {
      // Evaluate the span text content within the item
      const spanText = await item.evaluate((element) => {
        const span = element.querySelector(
          "div.pull-left.selection-text > strong"
        );
        return span ? span.textContent.trim() : "";
      });

      // Check if span text matches codeItem
      if (spanText === codeItem) {
        // Find and modify the input field within the same item
        const inputSelector = 'input[type="numeric"]';
        const input = await item.$(inputSelector);
        if (input) {
          await input.click({ clickCount: 3 }); // Select all text in the input
          await input.press("Backspace"); // Clear existing value
          await input.type(amountItem, { delay: 200 }); // Type new value
        }

        // Click the "add to chart" button
        const chartSelector =
          "button.btn.btn-default.btn-prima.btn-basket.ladda-button.btn-outline-success.pull-right";
        await page.waitForSelector(chartSelector);
        await page.click(chartSelector);

        // Optionally, wait for some time for the operation to complete
        consoleLog(`ADDED TO CHART CODE:${spanText}, AMOUNT ${amountItem}`);
        await setTimeout(3000); // Adjust as necessary

        foundMatch = true; // Set flag to true since a match was found
        break; // Exit the loop since a match was found
      }
    }

    // No code match
    if (!foundMatch) {
      consoleLog(`NO ITEM MATCH CODE: ${codeItem}`);
    }

    await setTimeout(1000);

    return true;
  } catch (error) {
    console.log(error);

    return false;
  }
}

// Function looking search products
async function productsSearchResult(page) {
  const product = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll("div.tabellenspalte.d-xl-none")
    );
    return items.length > 0; // Return true if items are found
  });

  return product;
}

// Check items span
async function findSpan(page) {
  const spanItems = await page.evaluate(() => {
    const spans = document.querySelectorAll("div.artnr.pull-left");
    return Array.from(spans).map((el) =>
      el.textContent.trim().replace("art.: ", "")
    );
  });

  return spanItems;
}

// Click dropdown
async function clickDropDown(page) {
  const showAllProducts = "div.input-line > button";
  await page.waitForSelector(showAllProducts);
  await page.click(showAllProducts);
  await setTimeout(3500);
}

(async () => {
  try {
    // Auth to google apis
    const auth = await authorize();
    const items = await readSpreadsheet(auth);

    // Spread codes, amounts, helps
    const { codes, amounts, helps } = items.reduce(
      (acc, item) => {
        acc.codes.push(item.code);
        acc.amounts.push(item.amount);
        acc.helps.push(item.help);
        return acc;
      },
      { codes: [], amounts: [], helps: [] }
    );
    // const codes = items.map((item) => item.code);
    // const amounts = items.map((item) => item.amount);
    // const helps = items.map((item) => item.help);

    // Setting page for browser
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--enable-blink-features=HTMLImports"],
    });
    const page = await browser.newPage();

    // Login process bodynova
    const loginSuccessfully = await loginPage(
      page,
      email,
      password,
      browser,
      loginUrl
    );
    await setTimeout(1000);
    if (loginSuccessfully) {
      let index = 1;
      for (let item = 0; item < codes.length; item++) {
        const codeItem = codes[item];
        const amountItem = amounts[item];
        const helpItem = helps[item];
        const codeItemToLower = codeItem.toLowerCase()

        console.log(`================================= PROCESSING ITEMS ${index}`);

        try {
          await page.goto(
            `https://sales.bodynova.com/index.php?stoken=DAAF82D7&lang=1&cl=search&searchparam=${codeItem}`,
            { waitUntil: "domcontentloaded" }
          );
          await setTimeout(1000);

          // If product exists
          const existProduct = await productsSearchResult(page);
          await setTimeout(1000);

          // spans
          const spanItems = await findSpan(page);

          const codeItemHelp = codeItem.match(/\d+/)[0];
          const codePattern = `${codeItemHelp}x`;

          // Condition will be reverse
          if (existProduct && spanItems.includes(codePattern)) {
            consoleLog(
              `FOUND CODE:\x1b[1m${codeItem}\x1b[0m, WITHOUT HELP-CODES`
            );
            await setTimeout(1000);

            // Click the dropdown menu
            // const showAllProducts = "div.input-line > button";
            // await page.waitForSelector(showAllProducts);
            // await page.click(showAllProducts);
            // await setTimeout(3500);

            // const itemsVarianSelector =
            //   "td.ebenetitel.d-none.d-xl-table-cell";
            // await page.waitForSelector(itemsVarianSelector);
            // const itemsVarian = await page.$$(itemsVarianSelector);

            const spansFound = await findSpan(page)
            let foundMatch = false;
            for (let span of spansFound) {
              // console.log(span)
              if (span === codeItem) {          // Cek span in products ---before clicking the view btn
                console.log(`found match w/ code ${codeItem}`);
                // Click dropdown
                await clickDropDown(page)
                // Click Varian menu
                const itemsVarianSelector = "td.ebenetitel.d-none.d-xl-table-cell";
                await page.waitForSelector(itemsVarianSelector);
                const itemsVarian = await page.$$(itemsVarianSelector);
                // Implement add to chart function
                await addToChart(page, codeItem, amountItem, itemsVarian);
                foundMatch = true;
                break; //
              }
            }
            if (!foundMatch) {
              consoleLog(`No match found for ${codeItem}.`);
              consoleLog(`TRYING SEARCH WITH HELP-CODES ...`);
              await page.goto(
                `https://sales.bodynova.com/index.php?stoken=DAAF82D7&lang=1&cl=search&searchparam=${helpItem}`,
                { waitUntil: "domcontentloaded" }
              );
              await setTimeout(1000);

              const existProductHelp = await productsSearchResult(page);
              if (existProductHelp) {
                consoleLog(`FOUND WITH HELP-CODES:${helpItem}`);
                await setTimeout(1000);
                // Click dropdown
                await clickDropDown(page)
                // Click varian menu
                const itemsVarianSelector = "td.ebenetitel.d-none.d-xl-table-cell";
                await page.waitForSelector(itemsVarianSelector);
                const itemsVarian = await page.$$(itemsVarianSelector);
                // Implement add to chart function
                await addToChart(page, codeItem, amountItem, itemsVarian);
              }
            }
          } else {        // Condition Help-Code Works
            await setTimeout(1000);
            consoleLog(
              `NOT-FOUND CODE:\x1b[1m${codeItem}\x1b[0m, TRYING SEARCH WITH HELP-CODES ...`
            );
            await page.goto(
              `https://sales.bodynova.com/index.php?stoken=DAAF82D7&lang=1&cl=search&searchparam=${helpItem}`,
              { waitUntil: "domcontentloaded" }
            );

            await setTimeout(1000);

            const existProductHelp = await productsSearchResult(page);
            if (existProductHelp) {
              // pick the product
              consoleLog(`FOUND WITH HELP-CODES:${helpItem}`);
              await setTimeout(1000);

              // Pick the product
              // Click the dropdown menu
              const showAllProducts = "div.input-line > button";
              await page.waitForSelector(showAllProducts);
              await page.click(showAllProducts);
              await setTimeout(3500);

              const itemsVarianSelector =
                "td.ebenetitel.d-none.d-xl-table-cell";
              await page.waitForSelector(itemsVarianSelector);
              const itemsVarian = await page.$$(itemsVarianSelector);

              // Implement add to chart function
              await addToChart(page, codeItem, amountItem, itemsVarian);
            } else {
              // Condition if code-C is filled
              await setTimeout(1000);
              consoleLog(`NOT-FOUND WITH HELP-CODES:\x1b[1m${helpItem}\x1b[0m`);
              index++;
              continue;
            }
          }
        } catch (error) {
          console.log(error);
        }

        index++;
      }
    }

    await browser.close();
  } catch (error) {
    console.log(error);
  }
})();
