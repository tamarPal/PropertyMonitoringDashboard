# Property Monitoring Dashboard

## Overview
This system allows the user to enter an APN (Assessor Parcel Number) and receive all cases related to that property. The system fetches data from an external source, processes it, and presents it in a clear dashboard. To improve performance, the system stores fetched data in a local SQLite database.

## How the system works
The user enters an APN. The backend fetches property details and related cases, processes the data, and saves it in SQLite. On repeated searches, data is returned from SQLite for faster performance, unless a refresh is required.

## Performance Notes
The initial data fetch may take approximately 2 minutes, as it requires scraping and processing data from the external source. However, subsequent searches are significantly faster (around 1 second), thanks to the local SQLite caching.

If more time were available, I would further optimize the initial loading time to improve the overall user experience.

## Run Instructions

Install dependencies:
npm install
cd server
npm install
cd ..
cd client
npm install
cd ..

Run the project:
npm run dev

This command runs both the backend and frontend. No need to open multiple terminals.

Frontend: http://localhost:5173  
Backend: http://localhost:5000  

## Data Design – What fields were saved and why
The system stores the following fields for each case:

- Case ID – unique identifier  
- Case Type – describes the case  
- Created Date – helps understand if the case is new or old  
- Compliance Date – helps determine urgency  
- Closed Date – shows if the case is open or closed  

These fields were chosen because they provide the most important information for decision making:
- Is the case new or old  
- Is it urgent or overdue  
- Is it still open or already closed  

## Understanding the requirement
The goal was to extract meaningful information from a complex external system and present it in a clear and useful way. The focus was on identifying the most important fields and making the data easy to understand.

## Data Presentation
The system presents data in two ways:

Summary:
- Total cases  
- Open / Closed  
- Urgent  
- Overdue  
- New  

Table:
- Case ID  
- Type  
- Dates  
- Status  

This allows quick understanding and deeper inspection.
I saved the fields for the date of receipt,Compliance Date,and date of closed to get an indication of the status of the review.

## Status Definitions
- NEW – recently created cases with no compliance date yet  
- IN_PROGRESS – open cases that are not urgent and not overdue  
- URGENT – cases with a compliance date approaching soon  
- OVERDUE – cases where the compliance date has already passed  
- CLOSED – cases that have been completed and closed 
 
## Key Design Principles
- Focus on meaningful data  
- Clear and simple UI  
- Easy to run system  
- Reliable and practical solution  

## Future Improvements
If more time was available, I would expand the system to analyze multiple properties and include a more comprehensive analysis across all property types and case categories. I would also improve database structure and security, deploy the system online, enhance UI/UX, and add smarter caching and real-time updates. Additionally, I would focus on improving the initial data loading performance.

## Technologies Used
Node.js, Express, React, SQLite, Axios, Cheerio, Playwright

## Summary
A complete system that retrieves, processes and presents property case data in a clear and actionable way, focusing on simplicity, performance and usability.