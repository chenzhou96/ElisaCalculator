import unittest

from elisa_calculator.io.readers import read_table_from_raw_text


class TestReaders(unittest.TestCase):
    def test_read_table_auto_default_header(self):
        raw = "1,0.9,1.1\n2,0.7,0.8\n3,0.2,0.3"
        df, meta = read_table_from_raw_text(raw)

        self.assertIsNotNone(df)
        self.assertEqual(meta['header_mode'], 'auto_default')
        self.assertEqual(df.columns.tolist(), ['concentration', 'col_1', 'col_2'])
        self.assertEqual(df.shape, (3, 3))

    def test_read_table_user_header(self):
        raw = "Conc,GroupA,GroupB\n1,0.9,1.1\n2,0.7,0.8\n3,0.2,0.3"
        df, meta = read_table_from_raw_text(raw)

        self.assertIsNotNone(df)
        self.assertEqual(meta['header_mode'], 'user_header')
        self.assertEqual(df.columns.tolist(), ['Conc', 'GroupA', 'GroupB'])
        self.assertEqual(df.shape, (3, 3))


if __name__ == '__main__':
    unittest.main()
