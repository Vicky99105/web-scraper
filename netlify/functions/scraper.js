const { chromium } = require('playwright');

// Extract menu items from a page
async function extractMenuItems(page, restaurantName) {
    // Use a promise to create a delay
    // await new Promise(resolve => setTimeout(resolve, 3000));

    // Correctly pass the restaurantName to the $$eval function
    const itemsAvailable = await page.$$eval('div.itemInfo', (items, restaurant) => {
        return items.map(item => ({
            restaurantName: restaurant,  // Use the passed restaurant name inside the map
            itemName: item.querySelector('div.itemHeader > span.headerText')?.textContent.trim(),
            price: item.querySelector('div.priceAvailability > span.price')?.textContent.trim()
        }));
    }, restaurantName); // Pass restaurantName as the second argument after the selector and function

    return itemsAvailable;
}

// Main function to orchestrate the scraping
async function searchToastTab(location = 'Palo Alto, CA', usermsg = 'chinese', n_restaurants = 5, n_items = 5) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let restaurants = [];

    try {
        await page.goto('https://www.toasttab.com/local');
        await page.waitForSelector('input[type="text"]');
        await page.fill('input[type="text"]', location);
        await page.waitForSelector('.prediction', { timeout: 6000 });
        await Promise.all([
            page.waitForNavigation(),
            page.click('button.prediction[tabindex="0"]')
        ]);

        await page.waitForSelector('.filters', { timeout: 2000 });

        // Inputting cuisine, restaurant, dish
        await page.fill('input[aria-label="Search"]', usermsg);
        await Promise.all([
            page.waitForSelector('div.submit-button'),
            page.click('div.submit-button')
        ]);
        
        await page.waitForSelector('.rx-card-wrapper'); // Ensure the filter has been applied

        // Scrape restaurant data
        let restaurantData = await page.evaluate(({ cuisine, loc }) => {
            const cards = document.querySelectorAll('.rx-card-container.pure-u-24-24.pure-u-md-12-24.pure-u-lg-8-24');
            return Array.from(cards).map((card, index) => {
                const ratingText = card.querySelector('div.avg-rating')?.getAttribute('title');
                const match = ratingText ? ratingText.match(/This restaurant has a (\d\.\d) rating from (\d+) reviews/) : null;
                return {
                    id: (index + 1).toString(),
                    name: card.querySelector('h3.rx-name').textContent.trim(),
                    avgRating: match ? match[1] : null,
                    noOfReviews: match ? match[2] : null,
                    link: card.querySelector('a').href,
                    cuisine: cuisine,
                    location: loc
                };
            });
        }, { cuisine: usermsg, loc: location });

        // Limit to n_restaurants
        restaurantData = restaurantData.slice(0, n_restaurants);

        // Extract menu items for each restaurant
        for (const restaurant of restaurantData) {
            const newPage = await browser.newPage();
            await newPage.goto(restaurant.link);
            try {
                await newPage.waitForSelector('div.itemInfo', { timeout: 10000 });
                let menuItems = await extractMenuItems(newPage, restaurant.name);
                
                // Limit menu items to n_items per restaurant
                menuItems = menuItems.slice(0, n_items).map((item, index) => ({
                    productId: `${restaurant.id}${(index + 1).toString().padStart(2, '0')}`,
                    name: item.itemName,
                    price: parseFloat(item.price.replace('$', ''))
                }));

                restaurants.push({
                    id: restaurant.id,
                    name: restaurant.name,
                    cuisine: restaurant.cuisine,
                    location: restaurant.location,
                    menu: menuItems
                });
            } catch (error) {
                console.log(`Failed to load menu items for ${restaurant.name}, error: ${error.message}`);
                continue;
            } finally {
                await newPage.close();
            }
        }

    } catch (error) {
        console.error('Error during scraping:', error);
    } finally {
        await browser.close();
    }

    return restaurants;
}

// // Usage
// searchToastTab().then(restaurants => {
//     console.log(JSON.stringify(restaurants, null, 2));
// });

exports.handler = exports.handler = async function(event) {
    // Retrieve parameters from the query string
    const params = event.queryStringParameters;
    const location = params.location || 'Palo Alto, CA';
    const usermsg = params.usermsg || 'chinese';
    const n_restaurants = parseInt(params.n_restaurants, 10) || 5;
    const n_items = parseInt(params.n_items, 10) || 5;

    let restaurants = [];

    try {
        
        restaurants = searchToastTab()

        return {
            statusCode: 200,
            body: JSON.stringify({ restaurants })
        };
    } catch (error) {
        console.error('Error during scraping:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to scrape data' })
        };
    }
};