ALTER TABLE reservations
  ADD COLUMN payment_order_id VARCHAR(50) NULL UNIQUE,
  ADD COLUMN payment_id VARCHAR(50) NULL;

CREATE TABLE IF NOT EXISTS payment_orders (
  order_id VARCHAR(50) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  guests TINYINT UNSIGNED NOT NULL,
  notes VARCHAR(1000) NOT NULL DEFAULT '',
  amount_paise INT UNSIGNED NOT NULL,
  status ENUM('created', 'upi_pending', 'paid', 'failed') NOT NULL DEFAULT 'created',
  payment_id VARCHAR(50) NULL,
  utr VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  CONSTRAINT payment_orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX payment_orders_status_idx (status),
  INDEX payment_orders_created_idx (created_at)
);

ALTER TABLE payment_orders
  MODIFY COLUMN status ENUM('created', 'upi_pending', 'paid', 'failed') NOT NULL DEFAULT 'created',
  ADD COLUMN utr VARCHAR(50) NULL;