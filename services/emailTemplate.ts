const { TAIGER_SIGNATURE } = require('../constants');
const { TENANT_NAME, TENANT_PORTAL_LINK } = require('../constants/common');

const htmlContent = (message) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
        font-family: 'Roboto', sans-serif;
        background-color: #f5f5f5;
        margin: 0;
        padding: 0;
    }
    .container {
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        box-sizing: border-box;
    }
    .header {
        text-align: center;
        background-color: #000000;
        color: #ffffff;
        padding: 10px 0;
        border-radius: 8px 8px 0 0;
    }
    .header h1 {
        margin: 0;
    }
    .content {
        padding: 10px;
        background-color: #fafafa;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        margin-top: 20px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        box-sizing: border-box;
    }
    .footer {
        text-align: center;
        color: #888888;
        padding: 10px 0;
    }
    .social-icons {
      margin-top: 10px;
    }
    .social-icons img {
        width: 24px;
        height: 24px;
        margin: 0 5px;
    }
    .img-radius {
      border-radius: 50%;
    }
    .mui-button {
        display: inline-block;
        padding: 6px 16px;
        font-size: 0.875rem;
        min-width: 64px;
        box-sizing: border-box;
        border-radius: 4px;
        text-transform: uppercase;
        background-color: #3f51b5;
        color: white !important;
        text-align: center;
        text-decoration: none;
        border: none;
        cursor: pointer;
        user-select: none;
        outline: 0;
        transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .mui-button:hover {
        background-color: #303f9f;
    }
    @media (max-width: 600px) {
      .header h1 {
        font-size: 1.2em;
      }
      .content, .footer {
        padding: 5px;
      }
    }
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
</head>
<body>
    <div class="container">
        <div class="header">
          <a
            href="${TENANT_PORTAL_LINK}"
            style={{ textDecoration: 'none' }}
          >
            <img
            src="${TENANT_PORTAL_LINK}assets/logo-new/Taiger_LT_C_H_EN-2x-3.png"
            alt="TaiGer"
            style=" max-height: 100px;"
            />
          </a>
    </div>
    <div class="content">
      ${message}
    </div>
    <div class="footer">
    ${TAIGER_SIGNATURE}
    </div>
  </div>
</body>
</html>
`;

module.exports = { htmlContent };
