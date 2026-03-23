const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async (to, subject, text, html) => {
  // Gracefully fallback to console logging if SMTP is not configured by the user yet
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your_gmail@gmail.com' || process.env.SMTP_USER === 'mock_user') {
    console.warn('SMTP variables not configured properly in .env. Falling back to console log email:');
    console.log(`\n================= EMAIL =================`);
    console.log(`To: ${to}\nSubject: ${subject}\nBody: ${text}`);
    console.log(`=========================================\n`);
    return true; 
  }

  try {
    const info = await transporter.sendMail({
      from: `"SMS Express" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
    console.log(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error.message);
    throw new Error('SMTP Error: Could not send email. Please verify your Gmail account and App Password in the .env file.');
  }
};

module.exports = {
  sendEmail,
};
